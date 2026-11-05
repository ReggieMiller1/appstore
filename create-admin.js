// Usage: node scripts/create-admin.js admin@example.com "StrongPassword"
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/create-admin.js <email> <password>');
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const password_hash = await bcrypt.hash(password, 12);
const { error } = await supabase.from('users').upsert({ email, password_hash }, { onConflict: 'email' });
if (error) { console.error(error.message); process.exit(1); }
console.log(`Admin user ready: ${email}`);
