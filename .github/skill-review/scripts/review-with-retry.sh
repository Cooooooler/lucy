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
set -uo pipefail

SIDE="${REVIEW_SIDE:?REVIEW_SIDE 未设置}"
SKILL="${REVIEW_SKILL:?REVIEW_SKILL 未设置}"
ANCHOR="${REVIEW_ANCHOR:?REVIEW_ANCHOR 未设置}"
OUT=".pr-skill-review/${SIDE}.md"
ERR=".pr-skill-review/${SIDE}.err"
MIN_BYTES=500
MIN_HANZI=30
MAX_ATTEMPTS=2
# 规范化的「无问题」结论（前后端共用同一句式，只差锚点词）
NO_ISSUE_CANON='未发现需要修改的问题'
# 「无问题」结论的常见变体。只在输出够短时启用（见 is_no_issue），
# 避免长评审正文里偶然出现这些词被误判成「无问题」。
NO_ISSUE_RE='未发现(任何|需要(修改|改动|调整)的)?问题|没有发现(任何)?问题|未见(任何)?问题|没有问题|无需(修改|改动|调整)|无问题'

run_once() {
  command-code -p "$(cat ".pr-skill-review/${SIDE}-prompt.txt")" \
    --no-skills \
    --skill ".github/skill-review/skills/${SKILL}" \
    --model "$SKILL_REVIEW_MODEL" \
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
  echo "${SIDE} review attempt ${attempt} invalid (early-stop suspected), retrying..." >&2
  attempt=$((attempt + 1))
  run_once
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
