#!/usr/bin/env bash
# 单侧技能评审：调用失败或疑似模型早停时重试一次。
#
# 环境变量（由 workflow 传入）：
#   REVIEW_SIDE   frontend | backend（决定 prompt/patch/输出文件名）
#   REVIEW_SKILL  技能目录名（与 .github/skill-review/skills 下一致）
#   REVIEW_ANCHOR 中文锚点（前端=前端，后端=后端）；仅在环境不支持 grep -P 时作为回退判据
#   SKILL_REVIEW_MODEL  账号网关内的模型 id（workflow env 透传，当前固定
#                         deepseek/deepseek-v4.1-flash；不再走 BYOK providers.json）
#
# 合格判定（is_valid）：
#   0. 判为「无问题」结论（is_no_issue）直接合格：它天然很短（约 39 字节），
#      若按长度判废，干净的评审结果就永远发不出去。
#      —— 只认规范句式会吞掉干净结论：模型常把「未发现需要修改的问题」改写成
#      「未发现问题」等说法，随后被判废→判空，明明没问题反而什么都不发。
#      故这里接受一组常见变体，命中变体时统一回规范句式（见文件末尾），
#      保证「没发现问题」也一定出现在评论里。
#   1. 输出 < 500 字节（早停残稿的典型特征，参考：完整评审约 2000+ 字节）
#   2. 汉字数 < 30（早停残稿是英文思考草稿，几乎没有汉字）
#      —— 这里刻意**不用**「必须出现『前端』/『后端』」做判据：提示词里给的是路径写法，
#      模型因此会说 `apps/frontend/**` 而不是「前端」二字，正文不含该词并不代表评审无效。
#      实测两次被误判的输出分别是 2492 / 2584 字节的真实评审（含模型读完 5705 行补丁的说明）。
# 两次都不合格则输出判空：Assemble 步骤已有空保护，不会发出残缺评论。
# 每次判废都会把「字节数 + 汉字数 + 前 400 字节」打到 stderr，便于在 CI 日志里直接定位原因。
#
# 重试会降一档推理强度（--effort low）：默认强度下 deepseek-v4.1-flash 在
# 「大技能 + 大补丁」上下文里可能把输出预算全花在 reasoning 上——#132 的 run
# 44941214672 实测最后三轮连续 outputTokens=0（只有 thinking、没有正文），CLI 内部
# continuation_recovery 重试两次后放弃，text 模式只剩最后一句旁白（157/92 字节），
# 于是被判废。同一条命令加 --effort low 后 15 轮正常收尾、输出完整中文评审。
# 但降档并不总够：#132 的 17.7KB 补丁（含 SSE 修复）在 --effort low 下仍复现
# （run 44947769810：两次都只有 78/173 字节旁白），本地用 CLI 1.93 同样复现——
# 上下文涨到 ~70k~100k 后该模型会连续只吐 reasoning。因此重试还要换模型：
# SKILL_REVIEW_FALLBACK_MODEL（workflow 传入，默认 z-ai/glm-5.3-flash）。
# 实测同一补丁 + 同一 prompt，glm-5.3-flash 6 轮 37 秒产出完整中文评审。
# 降档 + 换模型只用于重试：首轮仍走主模型与 CLI 默认强度，不牺牲正常评审质量。
set -uo pipefail

SIDE="${REVIEW_SIDE:?REVIEW_SIDE 未设置}"
SKILL="${REVIEW_SKILL:?REVIEW_SKILL 未设置}"
ANCHOR="${REVIEW_ANCHOR:?REVIEW_ANCHOR 未设置}"
OUT=".pr-skill-review/${SIDE}.md"
ERR=".pr-skill-review/${SIDE}.err"
MIN_BYTES=500
MIN_HANZI=30
MAX_ATTEMPTS=2
# 单次 CLI 调用的硬超时（秒）。没有这层兜底时，模型请求一旦挂在半路，
# `command-code -p` 会一直等下去，只能等 job 级的 30 分钟 timeout 收场：
# #122 实测「后端评审」在 19.5KB 补丁上跑了 22 分钟仍无输出（正常约 4 分钟）。
# 600 秒对「读补丁 + 读规则 + 按需读源码」的完整评审足够宽裕；超时按失败处理，
# 由下面的重试逻辑再试一次，仍失败则判空、不发残缺评论。
ATTEMPT_TIMEOUT=600
# TERM 之后的强杀宽限（秒）。只用 `timeout <秒>` 时它发完 SIGTERM 就等进程自己退出，
# CLI 若忽略/吞掉 TERM（实测 #122 的 run 43619375051：attempt 在 600s 后仍活着，
# 最终是 job 的 30 分钟 timeout 清理孤儿进程），这层兜底等于无效。`-k` 在宽限期后
# 发 SIGKILL，保证单次尝试真的在 ~630s 内结束、重试有机会跑完。
ATTEMPT_KILL_GRACE=30
# 规范化的「无问题」结论（前后端共用同一句式，只差锚点词）
NO_ISSUE_CANON='未发现需要修改的问题'
# 「无问题」结论的常见变体。只在输出够短时启用（见 is_no_issue），
# 避免长评审正文里偶然出现这些词被误判成「无问题」。
NO_ISSUE_RE='未发现(任何|需要(修改|改动|调整)的)?问题|没有发现(任何)?问题|未见(任何)?问题|没有问题|无需(修改|改动|调整)|无问题'
# 重试用的推理强度与模型（见文件头注释）。空字符串 effort 表示不传 --effort，
# 沿用 CLI 默认；未配置备用模型时退回主模型。
RETRY_EFFORT=low
RETRY_MODEL="${SKILL_REVIEW_FALLBACK_MODEL:-$SKILL_REVIEW_MODEL}"

run_once() {
  local effort="${1:-}"
  local model="${2:-$SKILL_REVIEW_MODEL}"
  local effort_args=()
  if [ -n "$effort" ]; then
    effort_args=(--effort "$effort")
  fi
  timeout -k "$ATTEMPT_KILL_GRACE" "$ATTEMPT_TIMEOUT" \
    command-code -p "$(cat ".pr-skill-review/${SIDE}-prompt.txt")" \
    --no-skills \
    --skill ".github/skill-review/skills/${SKILL}" \
    --model "$model" \
    "${effort_args[@]}" \
    --trust \
    --skip-onboarding \
    --no-auto-update \
    --no-session \
    --max-turns 60 \
    > "$OUT" 2> "$ERR" \
    || echo "cmd exited $?" >> "$ERR"
}

# 输出里的汉字个数；环境不支持 grep -P（\p{Han}）时返回空字符串，调用方回退到锚点判断
hanzi_count() {
  grep -oP '\p{Han}' "$OUT" 2> /dev/null | wc -l | tr -d ' '
}

# 是否为「无问题」结论：规范句式任何长度都认；其余变体只认短输出（一句话结论）
is_no_issue() {
  [ -f "$OUT" ] || return 1
  grep -q "$NO_ISSUE_CANON" "$OUT" && return 0
  [ "$(wc -c < "$OUT" | tr -d ' ')" -lt "$MIN_BYTES" ] || return 1
  grep -Eq "$NO_ISSUE_RE" "$OUT"
}

is_valid() {
  [ -f "$OUT" ] || return 1
  # 「无问题」是合法结论，不以长度/汉字数判废
  is_no_issue && return 0
  local bytes hanzi
  bytes=$(wc -c < "$OUT" | tr -d ' ')
  [ "$bytes" -ge "$MIN_BYTES" ] || return 1
  hanzi=$(hanzi_count)
  if [ -n "$hanzi" ]; then
    [ "$hanzi" -ge "$MIN_HANZI" ] || return 1
  else
    grep -q "$ANCHOR" "$OUT" || return 1
  fi
  return 0
}

# 判废时把可诊断信息打到 stderr（workflow 的日志会带上），避免只留一句 "invalid" 无从查起
report_invalid() {
  local attempt="$1" bytes hanzi
  bytes=0
  [ -f "$OUT" ] && bytes=$(wc -c < "$OUT" | tr -d ' ')
  hanzi=$(hanzi_count)
  echo "[diagnostic] ${SIDE} attempt ${attempt} invalid: ${bytes} bytes (min ${MIN_BYTES}), hanzi: ${hanzi:-unsupported} (min ${MIN_HANZI}), anchor '${ANCHOR}' hit: $([ -f "$OUT" ] && grep -q "$ANCHOR" "$OUT" && echo yes || echo no)" >&2
  echo "[diagnostic] output head: $(head -c 400 "$OUT" 2> /dev/null | tr '\n' ' ')" >&2
}

attempt=1
run_once
while ! is_valid && [ "$attempt" -lt "$MAX_ATTEMPTS" ]; do
  report_invalid "$attempt"
  echo "${SIDE} review attempt ${attempt} invalid (early-stop suspected), retrying with ${RETRY_MODEL} --effort ${RETRY_EFFORT}..." >&2
  attempt=$((attempt + 1))
  run_once "$RETRY_EFFORT" "$RETRY_MODEL"
done

if is_valid; then
  # is_no_issue 命中但正文没有规范句式 ⇒ 走的是变体分支（必为短输出），统一回规范句式，
  # 让措辞不同但语义相同的「无问题」结果都能稳定落到评论里
  # （Assemble 以文件非空作为发送条件）。已是规范句式的输出原样保留。
  if is_no_issue && ! grep -q "$NO_ISSUE_CANON" "$OUT"; then
    printf '%s%s\n' "$ANCHOR" "$NO_ISSUE_CANON" > "$OUT"
    echo "${SIDE} review: no issue found, normalized to canonical line"
  fi
  echo "${SIDE}.md bytes: $(wc -c < "$OUT" | tr -d ' ')"
else
  report_invalid "$attempt"
  echo "${SIDE} review invalid after ${MAX_ATTEMPTS} attempts, discarding output" >&2
  : > "$OUT"
fi
tail -c 2000 "$ERR" || true
