interface RoleColorClasses {
  ring: string;
  tint: string;
  text: string;
}

const roleColorClasses: Record<string, RoleColorClasses> = {
  Tank: { ring: "ring-role-tank", tint: "bg-role-tank/15", text: "text-role-tank" },
  Bruiser: { ring: "ring-role-bruiser", tint: "bg-role-bruiser/15", text: "text-role-bruiser" },
  RangedAssassin: { ring: "ring-role-ranged", tint: "bg-role-ranged/15", text: "text-role-ranged" },
  MeleeAssassin: { ring: "ring-role-melee", tint: "bg-role-melee/15", text: "text-role-melee" },
  Healer: { ring: "ring-role-healer", tint: "bg-role-healer/15", text: "text-role-healer" },
  Support: { ring: "ring-role-support", tint: "bg-role-support/15", text: "text-role-support" },
};

const neutralColorClasses: RoleColorClasses = { ring: "ring-border", tint: "bg-muted/15", text: "text-muted" };

/** Role tint used for the avatar fallback ring/background and the Hero ID Card's role pill. Falls back to a neutral tone for heroes without a known role. */
export function heroRoleColorClasses(role: string | null | undefined): RoleColorClasses {
  return (role && roleColorClasses[role]) || neutralColorClasses;
}
