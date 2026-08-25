export type PdaRole = "PLANT_MANAGER" | "LINE_MANAGER" | "GROUP_LEADER";

export function resolvePdaRole(user: Record<string, unknown>): PdaRole {
  const username = String(user.username ?? "").toUpperCase();
  const roleText = `${String(user.role ?? "")} ${String(user.roleKey ?? "")} ${username}`.toLowerCase();
  if (username === "MENG_YING" || username === "MGT_CN_01" || /plant|factory|administrator|management|admin/.test(roleText)) return "PLANT_MANAGER";
  if (/line[_ -]?manager/.test(roleText)) return "LINE_MANAGER";
  return "GROUP_LEADER";
}

export const pdaRoleLabels: Record<PdaRole, string> = {
  PLANT_MANAGER: "Plant Manager",
  LINE_MANAGER: "Line Manager",
  GROUP_LEADER: "Group Leader",
};
