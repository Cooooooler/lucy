#!/usr/bin/env bash
# 单侧技能评审：调用失败或疑似模型早停时重试一次。
#
# 环境变量（由 workflow 传入）：
#   REVIEW_SIDE   frontend | backend（决定 prompt/patch/输出文件名）
#   REVIEW_SKILL  技能目录名（与 .github/skill-review/skills 下一致）
#   REVIEW_ANCHOR 评审输出必须包含的中文锚点（前端=前端，后端=后端）
#   SKILL_REVIEW_MODEL  BYOK 模型 id（workflow env 透传）
#
# 合格判定（is_valid）：
#   0. 命中「未发现需要修改的问题」= 规范化的「无问题」结论，直接合格。
#      它天然很短（约 39 字节），若按长度判废，干净的评审结果就永远发不出去。
#   1. 输出 < 500 字节（早停残稿的典型特征，参考：完整评审约 2000+ 字节）
#   2. 输出不含中文锚点（早停残稿是英文思考草稿，无中文）
# 两次都不合格则输出判空：Assemble 步骤已有空保护，不会发出残缺评论。
# 每次判废都会把「字节数 + 前 400 字节」打到 stderr，便于在 CI 日志里直接定位原因。
set -uo pipefail

SIDE="${REVIEW_SIDE:?REVIEW_SIDE 未设置}"
SKILL="${REVIEW_SKILL:?REVIEW_SKILL 未设置}"
ANCHOR="${REVIEW_ANCHOR:?REVIEW_ANCHOR 未设置}"
OUT=".pr-skill-review/${SIDE}.md"
ERR=".pr-skill-review/${SIDE}.err"
MIN_BYTES=500
MAX_ATTEMPTS=2
# 规范化的「无问题」结论（前后端共用同一句式，只差锚点词）
NO_ISSUE_RE='未发现需要修改的问题'

run_once() {
  command-code -p "$(cat ".pr-skill-review/${SIDE}-prompt.txt")" \
    --local-only \
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

is_valid() {
  [ -f "$OUT" ] || return 1
  # 「无问题」是合法结论，不以长度判废
  grep -q "$NO_ISSUE_RE" "$OUT" && return 0
  local bytes
  bytes=$(wc -c < "$OUT" | tr -d ' ')
  [ "$bytes" -ge "$MIN_BYTES" ] || return 1
  grep -q "$ANCHOR" "$OUT" || return 1
  return 0
}

# 判废时把可诊断信息打到 stderr（workflow 的日志会带上），避免只留一句 "invalid" 无从查起
report_invalid() {
  local attempt="$1" bytes anchor_hit
  bytes=0
  [ -f "$OUT" ] && bytes=$(wc -c < "$OUT" | tr -d ' ')
  anchor_hit=no
  [ -f "$OUT" ] && grep -q "$ANCHOR" "$OUT" && anchor_hit=yes
  echo "[diagnostic] ${SIDE} attempt ${attempt} invalid: ${bytes} bytes (min ${MIN_BYTES}), anchor '${ANCHOR}' hit: ${anchor_hit}" >&2
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
  echo "${SIDE}.md bytes: $(wc -c < "$OUT" | tr -d ' ')"
else
  report_invalid "$attempt"
  echo "${SIDE} review invalid after ${MAX_ATTEMPTS} attempts, discarding output" >&2
  : > "$OUT"
fi
tail -c 2000 "$ERR" || true
