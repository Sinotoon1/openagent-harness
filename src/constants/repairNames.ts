export const repairName = {
  stripNullOptional: "stripNullOptional",
  emptyObjectToArray: "emptyObjectToArray",
  parseJsonArrayString: "parseJsonArrayString",
  bareStringToArray: "bareStringToArray",
  markdownPathAutolinkUnwrap: "markdownPathAutolinkUnwrap"
} as const;

export const repairNames = [
  repairName.emptyObjectToArray,
  repairName.parseJsonArrayString,
  repairName.bareStringToArray,
  repairName.stripNullOptional,
  repairName.markdownPathAutolinkUnwrap
] as const;

export const repairExecutionOrder = [
  repairName.stripNullOptional,
  repairName.emptyObjectToArray,
  repairName.parseJsonArrayString,
  repairName.bareStringToArray,
  repairName.markdownPathAutolinkUnwrap
] as const;

export type RepairName = (typeof repairNames)[number];

export function repairNoteCode(name: RepairName): `repair.${RepairName}` {
  return `repair.${name}`;
}
