import pg from 'pg';
import { migrateIncomeTax } from './lib/migrate-income-tax.mjs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
try {await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(713056)');await migrateIncomeTax(client);await client.query('COMMIT');console.log('Jaarwerkplek inkomstenbelasting gereed. Grootboek ongewijzigd.');}
catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
