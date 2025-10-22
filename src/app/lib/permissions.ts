export type Position =
  | "Sales Manager"
  | "Site Manager"
  | "Media Handler"
  | "Supervisor"
  | "Manager"
  | "Admin"
  | "Superadmin";

export const POSITION_PERMISSIONS: Record<Position, { nav: string[]; actions: string[] }> = {
  Superadmin: {
    nav: ["Dashboard","Accounts","Inventory","Task","Orders","Content Management","Settings","Predictive","Reports","Announcement"],
    actions: ["create","read","update","delete","manage_users","manage_settings"],
  },
  Admin: {
    nav: ["Dashboard","Accounts","Inventory","Task","Orders","Content Management","Settings","Announcement"],
    actions: ["create","read","update","delete","manage_users"],
  },
  Manager: {
    nav: ["Dashboard","Inventory","Task","Orders","Reports"],
    actions: ["read","update","approve"],
  },
  "Sales Manager": {
    nav: ["Dashboard","Inventory","Orders","Reports"],
    actions: ["read","update_inventory","manage_orders"],
  },
  "Site Manager": {
    nav: ["Dashboard","Task","Inventory"],
    actions: ["read","update_task","update_inventory"],
  },
  "Media Handler": {
    nav: ["Dashboard","Content Management"],
    actions: ["read","create_media","update_media"],
  },
  Supervisor: {
    nav: ["Dashboard","Task","Inventory","Reports"],
    actions: ["read","update","approve"],
  },
};