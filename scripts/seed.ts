import { driver } from "../lib/neo4j";

const query = `
MERGE (acme:Organisation {id: 'acme'}) SET acme.name = 'Acme Corporation'
MERGE (john:User {id: 'u1'}) SET john.email = 'john@example.com', john.name = 'John Editor'
MERGE (john)-[:MEMBER_OF]->(acme)
MERGE (editor:Role {id: 'editor'}) SET editor.name = 'editor'
MERGE (john)-[:HAS_ROLE]->(editor)
MERGE (customerType:EntityType {id: 'customer'}) SET customerType.name = 'Customer'
MERGE (invoiceType:EntityType {id: 'invoice'}) SET invoiceType.name = 'Invoice'
MERGE (customers:Surface {id: 'customers'})
SET customers.name = 'Customers', customers.renderer = 'table', customers.icon = 'users',
    customers.config = '{"columns":["name","email","status"],"search":["name","email"],"defaultSort":"name","actions":["create","edit","delete"]}'
MERGE (customers)-[:USES]->(customerType)
MERGE (editor)-[access:CAN_ACCESS]->(customers)
SET access.read = true, access.create = true, access.update = true, access.delete = false
MERGE (invoices:Surface {id: 'invoices'})
SET invoices.name = 'Invoices', invoices.renderer = 'table', invoices.icon = 'receipt',
    invoices.config = '{"columns":["number","total","status"],"search":["number","status"],"defaultSort":"number","actions":["create","edit","delete"]}'
MERGE (invoices)-[:USES]->(invoiceType)
MERGE (editor)-[invoiceAccess:CAN_ACCESS]->(invoices)
SET invoiceAccess.read = true, invoiceAccess.create = true, invoiceAccess.update = true, invoiceAccess.delete = false
MERGE (ada:Customer {id: 'c1'}) SET ada.name = 'Ada Lovelace', ada.email = 'ada@analytical.engine', ada.status = 'Active'
MERGE (grace:Customer {id: 'c2'}) SET grace.name = 'Grace Hopper', grace.email = 'grace@navy.mil', grace.status = 'Active'
MERGE (linus:Customer {id: 'c3'}) SET linus.name = 'Linus Torvalds', linus.email = 'linus@kernel.org', linus.status = 'Prospect'
MERGE (ada)-[:BELONGS_TO]->(acme)
MERGE (grace)-[:BELONGS_TO]->(acme)
MERGE (linus)-[:BELONGS_TO]->(acme)
MERGE (compiler:Project {id: 'p1'}) SET compiler.name = 'Compiler modernisation'
MERGE (grace)-[:HAS_PROJECT]->(compiler)
MERGE (invoice1:Invoice {id: 'i1'}) SET invoice1.number = 'INV-1001', invoice1.total = 2400.00, invoice1.status = 'Paid'
MERGE (invoice2:Invoice {id: 'i2'}) SET invoice2.number = 'INV-1002', invoice2.total = 875.50, invoice2.status = 'Open'
MERGE (invoice3:Invoice {id: 'i3'}) SET invoice3.number = 'INV-1003', invoice3.total = 1200.00, invoice3.status = 'Overdue'
MERGE (ada)-[:HAS_INVOICE]->(invoice1)
MERGE (grace)-[:HAS_INVOICE]->(invoice2)
MERGE (linus)-[:HAS_INVOICE]->(invoice3)
`;

async function seed() {
  const session = driver.session();
  try {
    await session.run(query);
    console.log("Seeded John, editor permissions, Customers surface, and sample customers.");
  } finally {
    await session.close();
    await driver.close();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
