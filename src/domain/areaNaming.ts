function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function nextNumberedName(existingNames: string[], baseLabel: string) {
  const normalizedBase = baseLabel.trim();
  if (!normalizedBase) throw new Error("numbered_name_base_required");

  const pattern = new RegExp(`^${escapeRegExp(normalizedBase)}\\s+(\\d+)$`, "iu");
  let maximum = 0;

  for (const value of existingNames) {
    const match = pattern.exec(value.trim());
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number > maximum) maximum = number;
  }

  return `${normalizedBase} ${maximum + 1}`;
}
