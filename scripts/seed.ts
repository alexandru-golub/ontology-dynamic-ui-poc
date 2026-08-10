import { driver } from "../lib/neo4j";

const clearQuery = `MATCH (n) DETACH DELETE n`;

const query = `
// ---- Users & roles -------------------------------------------------------
CREATE (admin:User {id: 'admin_001', name: 'Ada Admin', isAdmin: true})
CREATE (john:User {id: 'user_101', name: 'John Doe', isAdmin: false})-[:HAS_ROLE]->(sales:Role {id: 'role_sales', name: 'Sales'})
CREATE (jane:User {id: 'user_202', name: 'Jane Smith', isAdmin: false})-[:HAS_ROLE]->(analyst:Role {id: 'role_analyst', name: 'Analyst'})
CREATE (adminRole:Role {id: 'role_admin', name: 'Admin'})
CREATE (admin)-[:HAS_ROLE]->(adminRole)

// ---- Surfaces (UI planes defined in the graph) ---------------------------
CREATE (projectsSurface:Surface {id: 'projects', title: 'Project Overview', name: 'Projects Matrix', renderer: 'table', rootLabel: 'Project'})
CREATE (customersSurface:Surface {id: 'customers', title: 'Customer Portfolio', name: 'Customers', renderer: 'table', rootLabel: 'Customer'})
CREATE (peopleSurface:Surface {id: 'people', title: 'People & Roles', name: 'People', renderer: 'table', rootLabel: 'User'})

// Projects surface — rows are Projects; columns come from Project, Customer and Status nodes
CREATE (c1:Column {id: 'col_customer', field: 'customer', label: 'Customer Name', order: 1, source: 'Customer.name', suggest: true})
CREATE (c2:Column {id: 'col_project', field: 'project', label: 'Project Title', order: 2, source: 'self.name'})
CREATE (c3:Column {id: 'col_status', field: 'status', label: 'Status', order: 3, source: 'Status.name', suggest: true})
CREATE (c4:Column {id: 'col_owner', field: 'owner', label: 'Owner', order: 4, source: 'self.owner', suggest: true})
CREATE (c5:Column {id: 'col_budget', field: 'budget', label: 'Budget (USD)', order: 5, source: 'self.budget'})
CREATE (projectsSurface)-[:HAS_COLUMN]->(c1)
CREATE (projectsSurface)-[:HAS_COLUMN]->(c2)
CREATE (projectsSurface)-[:HAS_COLUMN]->(c3)
CREATE (projectsSurface)-[:HAS_COLUMN]->(c4)
CREATE (projectsSurface)-[:HAS_COLUMN]->(c5)

// Customers surface — rows are Customers; columns mix Customer props and counts/names of linked Projects
CREATE (d1:Column {id: 'col2_customer', field: 'customer', label: 'Customer', order: 1, source: 'self.name', suggest: true})
CREATE (d2:Column {id: 'col2_projects', field: 'projects', label: 'Projects', order: 2, source: 'Project.count'})
CREATE (d3:Column {id: 'col2_example', field: 'example', label: 'Example Project', order: 3, source: 'Project.name'})
CREATE (d4:Column {id: 'col2_budget', field: 'budget', label: 'Largest Project Budget', order: 4, source: 'Project.budget'})
CREATE (customersSurface)-[:HAS_COLUMN]->(d1)
CREATE (customersSurface)-[:HAS_COLUMN]->(d2)
CREATE (customersSurface)-[:HAS_COLUMN]->(d3)
CREATE (customersSurface)-[:HAS_COLUMN]->(d4)

// People surface — rows are Users; columns mix User props and their Role names
CREATE (e1:Column {id: 'col3_user', field: 'user', label: 'Name', order: 1, source: 'self.name'})
CREATE (e2:Column {id: 'col3_role', field: 'role', label: 'Role', order: 2, source: 'Role.name', suggest: true})
CREATE (e3:Column {id: 'col3_admin', field: 'admin', label: 'Admin', order: 3, source: 'self.isAdmin'})
CREATE (peopleSurface)-[:HAS_COLUMN]->(e1)
CREATE (peopleSurface)-[:HAS_COLUMN]->(e2)
CREATE (peopleSurface)-[:HAS_COLUMN]->(e3)

// ---- Business data -------------------------------------------------------
CREATE (acme:Customer {id: 'customer_acme', name: 'Acme Corp'})
CREATE (globex:Customer {id: 'customer_globex', name: 'Globex'})
CREATE (initech:Customer {id: 'customer_initech', name: 'Initech'})
CREATE (project1:Project {id: 'project_redesign', name: 'Website Redesign', owner: 'John Doe', budget: 24000})
CREATE (project2:Project {id: 'project_app', name: 'Mobile App', owner: 'Jane Smith', budget: 68000})
CREATE (project3:Project {id: 'project_platform', name: 'Data Platform', owner: 'Ada Admin', budget: 120000})
CREATE (active:Status {id: 'status_active', name: 'Active'})
CREATE (draft:Status {id: 'status_draft', name: 'Draft'})
CREATE (done:Status {id: 'status_done', name: 'Done'})
CREATE (acme)-[:HAS_PROJECT]->(project1)
CREATE (project1)-[:HAS_STATUS]->(active)
CREATE (globex)-[:HAS_PROJECT]->(project2)
CREATE (project2)-[:HAS_STATUS]->(draft)
CREATE (acme)-[:HAS_PROJECT]->(project3)
CREATE (project3)-[:HAS_STATUS]->(done)

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
`;

async function seed() {
  const session = driver.session();
  try {
    await session.run(clearQuery);
    await session.run(query);
    console.log("Seeded admin, 2 demo users, 3 multi-source surfaces and permissions.");
  } finally {
    await session.close();
    await driver.close();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
