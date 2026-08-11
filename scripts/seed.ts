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
];

const query = `
// ---- Users & roles -------------------------------------------------------
CREATE (admin:User {id: 'admin_001', name: 'Ada Admin', isAdmin: true})
CREATE (john:User {id: 'user_101', name: 'John Doe', isAdmin: false})-[:HAS_ROLE]->(sales:Role {id: 'role_sales', name: 'Sales'})
CREATE (jane:User {id: 'user_202', name: 'Jane Smith', isAdmin: false})-[:HAS_ROLE]->(analyst:Role {id: 'role_analyst', name: 'Analyst'})
CREATE (adminRole:Role {id: 'role_admin', name: 'Admin'})
CREATE (admin)-[:HAS_ROLE]->(adminRole)

// ---- Surfaces (UI planes defined in the graph) ---------------------------
CREATE (projectsSurface:Surface {id: 'projects', title: 'Project Overview', name: 'Projects Matrix', renderer: 'table', rootLabel: 'Project'})
CREATE (customersSurface:Surface {id: 'customers', title: 'Customer Portfolio', name: 'Customers', renderer: 'cards', rootLabel: 'Customer'})
CREATE (peopleSurface:Surface {id: 'people', title: 'People & Roles', name: 'People', renderer: 'board', rootLabel: 'User'})
CREATE (boardSurface:Surface {id: 'board', title: 'Project Board', name: 'Projects Board', renderer: 'board', rootLabel: 'Project'})
CREATE (pivotSurface:Surface {id: 'pivot', title: 'Project Pivot', name: 'Projects Pivot', renderer: 'pivot', rootLabel: 'Project'})
CREATE (scheduleSurface:Surface {id: 'schedule', title: 'Project Schedule', name: 'Projects Schedule', renderer: 'gantt', rootLabel: 'Project'})

// Projects surface — rows are Projects; columns come from Project, Customer and Status nodes
CREATE (c1:Column {id: 'col_customer', field: 'customer', label: 'Customer Name', order: 1, source: '<HAS_PROJECT:Customer.name', suggest: true, type: 'string'})
CREATE (c2:Column {id: 'col_project', field: 'project', label: 'Project Title', order: 2, source: 'self.name', type: 'string'})
CREATE (c3:Column {id: 'col_status', field: 'status', label: 'Status', order: 3, source: '>HAS_STATUS:Status.name', suggest: true, type: 'string'})
CREATE (c4:Column {id: 'col_owner', field: 'owner', label: 'Owner', order: 4, source: 'self.owner', suggest: true, type: 'string'})
CREATE (c5:Column {id: 'col_budget', field: 'budget', label: 'Budget (USD)', order: 5, source: 'self.budget', type: 'money'})
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
CREATE (g2:Column {id: 'colg_start', field: 'start', label: 'Start', order: 2, source: 'self.start', type: 'date'})
CREATE (g3:Column {id: 'colg_due', field: 'due', label: 'Due', order: 3, source: 'self.due', type: 'date'})
CREATE (g4:Column {id: 'colg_owner', field: 'owner', label: 'Owner', order: 4, source: 'self.owner', type: 'string'})
CREATE (scheduleSurface)-[:HAS_COLUMN]->(g1)
CREATE (scheduleSurface)-[:HAS_COLUMN]->(g2)
CREATE (scheduleSurface)-[:HAS_COLUMN]->(g3)
CREATE (scheduleSurface)-[:HAS_COLUMN]->(g4)

// ---- Business data -------------------------------------------------------
CREATE (acme:Customer {id: 'customer_acme', name: 'Acme Corp'})
CREATE (globex:Customer {id: 'customer_globex', name: 'Globex'})
CREATE (initech:Customer {id: 'customer_initech', name: 'Initech'})
CREATE (project1:Project {id: 'project_redesign', name: 'Website Redesign', owner: 'John Doe', budget: 24000, start: '2026-01-05', due: '2026-03-20'})
CREATE (project2:Project {id: 'project_app', name: 'Mobile App', owner: 'Jane Smith', budget: 68000, start: '2026-02-01', due: '2026-06-30'})
CREATE (project3:Project {id: 'project_platform', name: 'Data Platform', owner: 'Ada Admin', budget: 120000, start: '2026-04-10', due: '2026-09-15'})
CREATE (project4:Project {id: 'project_crm', name: 'CRM Migration', owner: 'John Doe', budget: 45000, start: '2026-01-15', due: '2026-04-30'})
CREATE (project5:Project {id: 'project_analytics', name: 'Analytics Portal', owner: 'Ada Admin', budget: 88000, start: '2026-05-01', due: '2026-08-31'})
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

// ---- Permissions ---------------------------------------------------------
// John (Sales): full row CRUD on projects (delete via override), manage on customers.
CREATE (sales)-[:CAN_ACCESS {view: true, create: true, update: true, delete: false, export: true, manage: false}]->(projectsSurface)
CREATE (john)-[:SURFACE_OVERRIDE {delete: true}]->(projectsSurface)
CREATE (sales)-[:CAN_ACCESS {view: true, create: true, update: true, delete: true, export: true, manage: true}]->(customersSurface)

// Jane (Analyst): read-only + export everywhere.
CREATE (analyst)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(projectsSurface)
CREATE (analyst)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(customersSurface)

// Everyone can view People & Roles; only admins (flag) can manage users there.
CREATE (sales)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(peopleSurface)
CREATE (analyst)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(peopleSurface)

// Project Board — Sales can move cards between lanes (update); Analyst read-only.
CREATE (sales)-[:CAN_ACCESS {view: true, create: true, update: true, delete: false, export: true, manage: false}]->(boardSurface)
CREATE (analyst)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(boardSurface)

// Pivot + Schedule — read-only + export for everyone.
CREATE (sales)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(pivotSurface)
CREATE (analyst)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(pivotSurface)
CREATE (sales)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(scheduleSurface)
CREATE (analyst)-[:CAN_ACCESS {view: true, create: false, update: false, delete: false, export: true, manage: false}]->(scheduleSurface)
`;

async function seed() {
  const session = driver.session();
  try {
    for (const constraint of constraints) await session.run(constraint);
    await session.run(clearQuery);
    await session.run(query);
    console.log("Seeded admin, 2 demo users, 6 multi-source surfaces, typed columns and permissions.");
  } finally {
    await session.close();
    await driver.close();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
