#!/usr/bin/env bash
# 单侧技能评审：调用失败或疑似模型早停时重试一次。
#
# 环境变量（由 workflow 传入）：
#   REVIEW_SIDE   frontend | backend（决定 prompt/patch/输出文件名）
#   REVIEW_SKILL  技能目录名（与 .github/skill-review/skills 下一致）
#   REVIEW_ANCHOR 评审输出必须包含的中文锚点（前端=前端，后端=后端）
#   SKILL_REVIEW_MODEL  BYOK 模型 id（workflow env 透传）
#
# 早停判定（任一命中即不合格）：
#   1. 输出 < 500 字节（参考：PR #43 早停残稿仅 120 字节，完整评审约 2000+ 字节）
#   2. 输出不含中文锚点（早停残稿是英文思考草稿，无中文）
# 两次都不合格则输出判空：Assemble 步骤已有空保护，不会发出残缺评论。
set -uo pipefail

SIDE="${REVIEW_SIDE:?REVIEW_SIDE 未设置}"
SKILL="${REVIEW_SKILL:?REVIEW_SKILL 未设置}"
ANCHOR="${REVIEW_ANCHOR:?REVIEW_ANCHOR 未设置}"
OUT=".pr-skill-review/${SIDE}.md"
ERR=".pr-skill-review/${SIDE}.err"
MIN_BYTES=500
MAX_ATTEMPTS=2

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
  local bytes
  bytes=$(wc -c < "$OUT" | tr -d ' ')
  [ "$bytes" -ge "$MIN_BYTES" ] || return 1
  grep -q "$ANCHOR" "$OUT" || return 1
  return 0
}

attempt=1
run_once
while ! is_valid && [ "$attempt" -lt "$MAX_ATTEMPTS" ]; do
  echo "${SIDE} review attempt ${attempt} invalid (early-stop suspected), retrying..." >&2
  attempt=$((attempt + 1))
  run_once
done

if is_valid; then
  echo "${SIDE}.md bytes: $(wc -c < "$OUT" | tr -d ' ')"
else
  echo "${SIDE} review invalid after ${MAX_ATTEMPTS} attempts, discarding output" >&2
  : > "$OUT"
fi
tail -c 2000 "$ERR" || true
