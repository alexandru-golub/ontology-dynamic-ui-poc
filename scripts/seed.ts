import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { driver } from "../lib/neo4j";

const clearQuery = `MATCH (n) DETACH DELETE n`;

const constraints = [
  `CREATE CONSTRAINT user_id IF NOT EXISTS FOR (n:User) REQUIRE n.id IS UNIQUE`,
  `CREATE CONSTRAINT surface_id IF NOT EXISTS FOR (n:Surface) REQUIRE n.id IS UNIQUE`,
  `CREATE CONSTRAINT column_id IF NOT EXISTS FOR (n:Column) REQUIRE n.id IS UNIQUE`,
  `CREATE CONSTRAINT role_name IF NOT EXISTS FOR (n:Role) REQUIRE n.name IS UNIQUE`,
  `CREATE CONSTRAINT customer_name IF NOT EXISTS FOR (n:Customer) REQUIRE n.name IS UNIQUE`,
  `CREATE CONSTRAINT status_name IF NOT EXISTS FOR (n:Status) REQUIRE n.name IS UNIQUE`,
  `CREATE CONSTRAINT project_id IF NOT EXISTS FOR (n:Project) REQUIRE n.id IS UNIQUE`,
  `CREATE CONSTRAINT session_token_hash IF NOT EXISTS FOR (n:Session) REQUIRE n.tokenHash IS UNIQUE`,
];

const query = `
// ---- Users & roles (real people = User; hats = Role) ---------------------
// Passwords come from HAT_PASSWORD (or are generated and printed). Users
// without a passwordHash cannot log in until an admin sets one.
CREATE (admin:User {id: 'admin_001', name: 'Ada Admin', isAdmin: true, passwordHash: $pw})
CREATE (john:User {id: 'user_101', name: 'John Doe', isAdmin: false, passwordHash: $pw})
CREATE (jane:User {id: 'user_202', name: 'Jane Smith', isAdmin: false, passwordHash: $pw})
CREATE (sam:User {id: 'user_303', name: 'Sam Rivera', isAdmin: false, passwordHash: $pw})
CREATE (adminRole:Role {id: 'role_admin', name: 'Admin'})
CREATE (pm:Role {id: 'role_pm', name: 'Project Manager'})
CREATE (bizdev:Role {id: 'role_bizdev', name: 'Business Development'})
CREATE (engineer:Role {id: 'role_engineer', name: 'Software Engineer'})
CREATE (admin)-[:HAS_ROLE]->(adminRole)
CREATE (john)-[:HAS_ROLE]->(pm)
CREATE (jane)-[:HAS_ROLE]->(bizdev)
CREATE (sam)-[:HAS_ROLE]->(engineer)

// ---- Surfaces (UI planes defined in the graph) ---------------------------
CREATE (projectsSurface:Surface {id: 'projects', title: 'Project Overview', name: 'Projects Matrix', renderer: 'table', rootLabel: 'Project'})
CREATE (customersSurface:Surface {id: 'customers', title: 'Customer Portfolio', name: 'Customers', renderer: 'cards', rootLabel: 'Customer'})
CREATE (peopleSurface:Surface {id: 'people', title: 'People & Roles', name: 'People', renderer: 'board', rootLabel: 'User'})
CREATE (boardSurface:Surface {id: 'board', title: 'Project Board', name: 'Projects Board', renderer: 'board', rootLabel: 'Project'})
CREATE (pivotSurface:Surface {id: 'pivot', title: 'Project Pivot', name: 'Projects Pivot', renderer: 'pivot', rootLabel: 'Project'})
CREATE (scheduleSurface:Surface {id: 'schedule', title: 'Project Schedule', name: 'Projects Schedule', renderer: 'gantt', rootLabel: 'Project'})
CREATE (intakeSurface:Surface {id: 'intake', title: 'Project Intake', name: 'Projects Intake', renderer: 'form', rootLabel: 'Project'})
CREATE (analyticsSurface:Surface {id: 'analytics', title: 'Customer Analytics', name: 'Customers Analytics', renderer: 'table', rootLabel: 'Customer'})
CREATE (calendarSurface:Surface {id: 'calendar', title: 'Project Calendar', name: 'Projects Calendar', renderer: 'calendar', rootLabel: 'Project'})

// Projects surface — rows are Projects; columns come from Project, Customer and Status nodes
CREATE (c1:Column {id: 'col_customer', field: 'customer', label: 'Customer Name', order: 1, source: '<HAS_PROJECT:Customer.name', suggest: true, type: 'string'})
CREATE (c2:Column {id: 'col_project', field: 'project', label: 'Project Title', order: 2, source: 'self.name', type: 'string', required: true, maxLength: 120})
CREATE (c3:Column {id: 'col_status', field: 'status', label: 'Status', order: 3, source: '>HAS_STATUS:Status.name', suggest: true, type: 'string'})
CREATE (c4:Column {id: 'col_owner', field: 'owner', label: 'Owner', order: 4, source: 'self.owner', suggest: true, type: 'string'})
CREATE (c5:Column {id: 'col_budget', field: 'budget', label: 'Budget (USD)', order: 5, source: 'self.budget', type: 'money', min: 0})
CREATE (projectsSurface)-[:HAS_COLUMN]->(c1)
CREATE (projectsSurface)-[:HAS_COLUMN]->(c2)
CREATE (projectsSurface)-[:HAS_COLUMN]->(c3)
CREATE (projectsSurface)-[:HAS_COLUMN]->(c4)
CREATE (projectsSurface)-[:HAS_COLUMN]->(c5)

// Customers surface — rows are Customers; columns mix Customer props and counts/names of linked Projects
CREATE (d1:Column {id: 'col2_customer', field: 'customer', label: 'Customer', order: 1, source: 'self.name', suggest: true, type: 'string'})
CREATE (d2:Column {id: 'col2_projects', field: 'projects', label: 'Projects', order: 2, source: 'Project.count', type: 'number'})
CREATE (d3:Column {id: 'col2_example', field: 'example', label: 'Example Project', order: 3, source: 'Project.name', type: 'string'})
CREATE (d4:Column {id: 'col2_budget', field: 'budget', label: 'Largest Project Budget', order: 4, source: 'Project.budget', type: 'money'})
CREATE (customersSurface)-[:HAS_COLUMN]->(d1)
CREATE (customersSurface)-[:HAS_COLUMN]->(d2)
CREATE (customersSurface)-[:HAS_COLUMN]->(d3)
CREATE (customersSurface)-[:HAS_COLUMN]->(d4)

// People surface — rows are Users; columns mix User props and their Role names
CREATE (e1:Column {id: 'col3_user', field: 'user', label: 'Name', order: 1, source: 'self.name', type: 'string'})
CREATE (e2:Column {id: 'col3_role', field: 'role', label: 'Role', order: 2, source: '>HAS_ROLE:Role.name', suggest: true, type: 'string'})
CREATE (e3:Column {id: 'col3_admin', field: 'admin', label: 'Admin', order: 3, source: 'self.isAdmin', type: 'boolean'})
CREATE (peopleSurface)-[:HAS_COLUMN]->(e1)
CREATE (peopleSurface)-[:HAS_COLUMN]->(e2)
CREATE (peopleSurface)-[:HAS_COLUMN]->(e3)

// Project Board — rows are Projects; the board renderer groups by Status and
// cards are dragged between lanes (a generic updateRow on the grouping field).
CREATE (f1:Column {id: 'colb_project', field: 'project', label: 'Project Title', order: 1, source: 'self.name', type: 'string'})
CREATE (f2:Column {id: 'colb_status', field: 'status', label: 'Status', order: 2, source: '>HAS_STATUS:Status.name', suggest: true, type: 'string'})
CREATE (f3:Column {id: 'colb_customer', field: 'customer', label: 'Customer', order: 3, source: '<HAS_PROJECT:Customer.name', suggest: true, type: 'string'})
CREATE (f4:Column {id: 'colb_owner', field: 'owner', label: 'Owner', order: 4, source: 'self.owner', suggest: true, type: 'string'})
CREATE (f5:Column {id: 'colb_budget', field: 'budget', label: 'Budget (USD)', order: 5, source: 'self.budget', type: 'money'})
CREATE (boardSurface)-[:HAS_COLUMN]->(f1)
CREATE (boardSurface)-[:HAS_COLUMN]->(f2)
CREATE (boardSurface)-[:HAS_COLUMN]->(f3)
CREATE (boardSurface)-[:HAS_COLUMN]->(f4)
CREATE (boardSurface)-[:HAS_COLUMN]->(f5)

// Project Pivot — renderer config is positional: row dim, column dim, value.
CREATE (p1:Column {id: 'colp_customer', field: 'customer', label: 'Customer', order: 1, source: '<HAS_PROJECT:Customer.name', type: 'string'})
CREATE (p2:Column {id: 'colp_status', field: 'status', label: 'Status', order: 2, source: '>HAS_STATUS:Status.name', type: 'string'})
CREATE (p3:Column {id: 'colp_budget', field: 'budget', label: 'Budget (USD)', order: 3, source: 'self.budget', type: 'money'})
CREATE (pivotSurface)-[:HAS_COLUMN]->(p1)
CREATE (pivotSurface)-[:HAS_COLUMN]->(p2)
CREATE (pivotSurface)-[:HAS_COLUMN]->(p3)

// Project Schedule — gantt renderer config is positional: name, start, due.
CREATE (g1:Column {id: 'colg_project', field: 'project', label: 'Project Title', order: 1, source: 'self.name', type: 'string'})
CREATE (g2:Column {id: 'colg_start', field: 'start', label: 'Start', order: 2, source: 'self.start', type: 'date', required: true})
CREATE (g3:Column {id: 'colg_due', field: 'due', label: 'Due', order: 3, source: 'self.due', type: 'date', required: true})
CREATE (g4:Column {id: 'colg_owner', field: 'owner', label: 'Owner', order: 4, source: 'self.owner', type: 'string'})
CREATE (scheduleSurface)-[:HAS_COLUMN]->(g1)
CREATE (scheduleSurface)-[:HAS_COLUMN]->(g2)
CREATE (scheduleSurface)-[:HAS_COLUMN]->(g3)
CREATE (scheduleSurface)-[:HAS_COLUMN]->(g4)

// Project Intake — form renderer demo: multi-record editing + validation rules.
// Rules live on the Column nodes and are enforced server-side on every write:
// required, min/max (numeric), minLength/maxLength, pattern, options (enum).
CREATE (h1:Column {id: 'colh_customer', field: 'customer', label: 'Customer', order: 1, source: '<HAS_PROJECT:Customer.name', suggest: true, type: 'string', required: true})
CREATE (h2:Column {id: 'colh_project', field: 'project', label: 'Project Title', order: 2, source: 'self.name', type: 'string', required: true, minLength: 4, maxLength: 120, validationMessage: 'Project title must be 4-120 characters'})
CREATE (h3:Column {id: 'colh_status', field: 'status', label: 'Status', order: 3, source: '>HAS_STATUS:Status.name', suggest: true, type: 'string'})
CREATE (h4:Column {id: 'colh_owner', field: 'owner', label: 'Owner', order: 4, source: 'self.owner', suggest: true, type: 'string', required: true})
CREATE (h5:Column {id: 'colh_priority', field: 'priority', label: 'Priority', order: 5, source: 'self.priority', type: 'string', required: true, options: ['Low', 'Medium', 'High']})
CREATE (h6:Column {id: 'colh_budget', field: 'budget', label: 'Budget (USD)', order: 6, source: 'self.budget', type: 'money', min: 0, max: 1000000})
CREATE (h7:Column {id: 'colh_start', field: 'start', label: 'Start', order: 7, source: 'self.start', type: 'date', required: true})
CREATE (h8:Column {id: 'colh_due', field: 'due', label: 'Due', order: 8, source: 'self.due', type: 'date', required: true})
CREATE (intakeSurface)-[:HAS_COLUMN]->(h1)
CREATE (intakeSurface)-[:HAS_COLUMN]->(h2)
CREATE (intakeSurface)-[:HAS_COLUMN]->(h3)
CREATE (intakeSurface)-[:HAS_COLUMN]->(h4)
CREATE (intakeSurface)-[:HAS_COLUMN]->(h5)
CREATE (intakeSurface)-[:HAS_COLUMN]->(h6)
CREATE (intakeSurface)-[:HAS_COLUMN]->(h7)
CREATE (intakeSurface)-[:HAS_COLUMN]->(h8)

// Customer Analytics — aggregate sources demo: rows are Customers; columns
// compute sums / averages / extremes over the typed HAS_PROJECT relationship.
// Read-only columns (aggregates are derived, never written).
CREATE (a1:Column {id: 'cola_customer', field: 'customer', label: 'Customer', order: 1, source: 'self.name', type: 'string', suggest: true})
CREATE (a2:Column {id: 'cola_projects', field: 'projects', label: 'Projects', order: 2, source: '>HAS_PROJECT:Project.count', type: 'number'})
CREATE (a3:Column {id: 'cola_total', field: 'total', label: 'Total Budget', order: 3, source: '>HAS_PROJECT:Project.budget.sum', type: 'money'})
CREATE (a4:Column {id: 'cola_avg', field: 'average', label: 'Average Budget', order: 4, source: '>HAS_PROJECT:Project.budget.avg', type: 'money'})
CREATE (a5:Column {id: 'cola_max', field: 'largest', label: 'Largest Project', order: 5, source: '>HAS_PROJECT:Project.budget.max', type: 'money'})
CREATE (a6:Column {id: 'cola_min', field: 'smallest', label: 'Smallest Project', order: 6, source: '>HAS_PROJECT:Project.budget.min', type: 'money'})
CREATE (analyticsSurface)-[:HAS_COLUMN]->(a1)
CREATE (analyticsSurface)-[:HAS_COLUMN]->(a2)
CREATE (analyticsSurface)-[:HAS_COLUMN]->(a3)
CREATE (analyticsSurface)-[:HAS_COLUMN]->(a4)
CREATE (analyticsSurface)-[:HAS_COLUMN]->(a5)
CREATE (analyticsSurface)-[:HAS_COLUMN]->(a6)

// Project Calendar — calendar renderer config is positional: name, start, due.
CREATE (k1:Column {id: 'colk_project', field: 'project', label: 'Project Title', order: 1, source: 'self.name', type: 'string'})
CREATE (k2:Column {id: 'colk_start', field: 'start', label: 'Start', order: 2, source: 'self.start', type: 'date'})
CREATE (k3:Column {id: 'colk_due', field: 'due', label: 'Due', order: 3, source: 'self.due', type: 'date'})
CREATE (calendarSurface)-[:HAS_COLUMN]->(k1)
CREATE (calendarSurface)-[:HAS_COLUMN]->(k2)
CREATE (calendarSurface)-[:HAS_COLUMN]->(k3)

// ---- Business data -------------------------------------------------------
CREATE (acme:Customer {id: 'customer_acme', name: 'Acme Corp'})
CREATE (globex:Customer {id: 'customer_globex', name: 'Globex'})
CREATE (initech:Customer {id: 'customer_initech', name: 'Initech'})
CREATE (project1:Project {id: 'project_redesign', name: 'Website Redesign', owner: 'John Doe', budget: 24000, start: '2026-01-05', due: '2026-03-20', priority: 'High'})
CREATE (project2:Project {id: 'project_app', name: 'Mobile App', owner: 'Jane Smith', budget: 68000, start: '2026-02-01', due: '2026-06-30', priority: 'Medium'})
CREATE (project3:Project {id: 'project_platform', name: 'Data Platform', owner: 'Ada Admin', budget: 120000, start: '2026-04-10', due: '2026-09-15', priority: 'High'})
CREATE (project4:Project {id: 'project_crm', name: 'CRM Migration', owner: 'John Doe', budget: 45000, start: '2026-01-15', due: '2026-04-30', priority: 'Medium'})
CREATE (project5:Project {id: 'project_analytics', name: 'Analytics Portal', owner: 'Ada Admin', budget: 88000, start: '2026-05-01', due: '2026-08-31', priority: 'Low'})
CREATE (active:Status {id: 'status_active', name: 'Active'})
CREATE (draft:Status {id: 'status_draft', name: 'Draft'})
CREATE (done:Status {id: 'status_done', name: 'Done'})
CREATE (acme)-[:HAS_PROJECT]->(project1)
CREATE (project1)-[:HAS_STATUS]->(active)
CREATE (globex)-[:HAS_PROJECT]->(project2)
CREATE (project2)-[:HAS_STATUS]->(draft)
CREATE (acme)-[:HAS_PROJECT]->(project3)
CREATE (project3)-[:HAS_STATUS]->(done)
CREATE (globex)-[:HAS_PROJECT]->(project4)
CREATE (project4)-[:HAS_STATUS]->(active)
CREATE (acme)-[:HAS_PROJECT]->(project5)
CREATE (project5)-[:HAS_STATUS]->(draft)

// ---- Permissions (per hat = per role) ------------------------------------
// Project Manager hat: full row CRUD on projects (delete via override), manage on customers.
CREATE (pm)-[:CAN_ACCESS {view: true, create: true, update: true, delete: false, export: true, manage: false}]->(projectsSurface)
CREATE (john)-[:SURFACE_OVERRIDE {delete: true}]->(projectsSurface)
CREATE (pm)-[:CAN_ACCESS {view: true, create: true, update: true, delete: true, export: true, manage: true}]->(customersSurface)

// Business Development hat: read-only + export everywhere, edits on intake.
CREATE (bizdev)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(projectsSurface)
CREATE (bizdev)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(customersSurface)
CREATE (bizdev)-[:CAN_ACCESS {view: true, create: true, update: true, delete: false, export: true, manage: false}]->(intakeSurface)

// Everyone can view People & Roles; only admins (flag) can manage users there.
CREATE (pm)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(peopleSurface)
CREATE (bizdev)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(peopleSurface)
CREATE (engineer)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(peopleSurface)

// Project Board — PM can move cards between lanes (update); others read-only.
CREATE (pm)-[:CAN_ACCESS {view: true, create: true, update: true, delete: false, export: true, manage: false}]->(boardSurface)
CREATE (bizdev)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(boardSurface)
CREATE (engineer)-[:CAN_ACCESS {view: true, create: false, update: true, delete: false, export: true, manage: false}]->(boardSurface)

// Pivot + Schedule — read-only + export for every hat.
CREATE (pm)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(pivotSurface)
CREATE (bizdev)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(pivotSurface)
CREATE (engineer)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(pivotSurface)
CREATE (pm)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(scheduleSurface)
CREATE (bizdev)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(scheduleSurface)
CREATE (engineer)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(scheduleSurface)

// Project Intake — PM creates/edits records (multi-record editing demo); Engineer read-only.
CREATE (pm)-[:CAN_ACCESS {view: true, create: true, update: true, delete: false, export: true, manage: false}]->(intakeSurface)
CREATE (engineer)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(intakeSurface)

// Customer Analytics — read-only + export for every hat (aggregate columns are derived).
CREATE (pm)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(analyticsSurface)
CREATE (bizdev)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(analyticsSurface)
CREATE (engineer)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(analyticsSurface)

// Project Calendar — read-only + export for every hat.
CREATE (pm)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(calendarSurface)
CREATE (bizdev)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(calendarSurface)
CREATE (engineer)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(calendarSurface)
`;

async function seed() {
  const { hashPassword } = await import("../lib/auth");
  // HAT_PASSWORD sets one password for every seeded account (dev convenience);
  // when missing, each account gets a random password printed to the console.
  const fixed = process.env.HAT_PASSWORD;
  const generated = new Map<string, string>();
  const passwordFor = (login: string) => {
    if (fixed) return fixed;
    const pw = `hat-${login}-${Math.random().toString(36).slice(2, 10)}`;
    generated.set(login, pw);
    return pw;
  };
  const pw = hashPassword(passwordFor("admin_001"));

  const session = driver.session();
  try {
    for (const constraint of constraints) await session.run(constraint);
    await session.run(clearQuery);
    await session.run(query, { pw });
    console.log("Seeded admin, 3 demo users, 4 hats (roles), 9 multi-source surfaces, validation rules and permissions.");
    if (generated.size > 0) {
      console.log("Generated login passwords (save them!):");
      for (const [login, password] of generated) console.log(`  ${login} / ${password}`);
    } else {
      console.log("All seeded accounts use the HAT_PASSWORD env value.");
    }
  } finally {
    await session.close();
    await driver.close();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
