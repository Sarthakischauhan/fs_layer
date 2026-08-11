/**
 * Explore a Neo4j graph as a filesystem (labels mode).
 *
 *   NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=password \
 *     npx tsx examples/neo4j-quickstart.ts
 */

import neo4j from "neo4j-driver";
import { Neo4jFs, createAgentBash } from "../src/index.js";

async function main() {
  const uri = process.env.NEO4J_URI ?? "bolt://localhost:7687";
  const user = process.env.NEO4J_USER ?? "neo4j";
  const password = process.env.NEO4J_PASSWORD ?? "password";

  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const session = driver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
    await session.run(`
      CREATE (a:Person {name: 'Alice', role: 'engineer'})
      CREATE (b:Person {name: 'Bob', role: 'designer'})
      CREATE (a)-[:KNOWS {since: 2020}]->(b)
    `);
  } finally {
    await session.close();
  }

  const fs = await Neo4jFs.create(driver, { mode: "labels" });
  const bash = createAgentBash({ fs });

  for (const cmd of ["ls /", "ls /Person", "ls /_rels", "head -c 400 $(ls /Person | head -1 | sed 's|^|/Person/|')"]) {
    const result = await bash.exec(cmd);
    console.log(`\n$ ${cmd}`);
    process.stdout.write(result.stdout || result.stderr);
  }

  await driver.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
