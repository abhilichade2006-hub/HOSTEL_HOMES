require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret-before-deployment';
// Use Node's built-in SQLite module so no native npm addon needs compiling.
// This avoids better-sqlite3 prebuilt-binary problems on newer Node versions.
const db = new DatabaseSync(path.join(__dirname, 'hostel-homes.sqlite'));
db.pragma = (statement) => db.exec(`PRAGMA ${statement}`);
db.transaction = (callback) => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback(...args);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'User' CHECK(role IN ('User','Owner','Admin')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS properties (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, type TEXT NOT NULL, rent INTEGER NOT NULL CHECK(rent > 0), deposit INTEGER NOT NULL DEFAULT 0, city TEXT NOT NULL, locality TEXT NOT NULL, facilities TEXT NOT NULL DEFAULT '[]', description TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', gender TEXT NOT NULL DEFAULT 'Any', image_url TEXT NOT NULL DEFAULT '', availability TEXT NOT NULL DEFAULT 'Available', status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS favourites (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,property_id));
CREATE TABLE IF NOT EXISTS enquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, move_date TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Contacted','Closed')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);

const count = db.prepare('SELECT COUNT(*) n FROM properties').get().n;
if (!count) {
  const seedOwner = db.prepare('SELECT id FROM users WHERE email=?').get('sample.owner@hostelhomes.local');
  let ownerId = seedOwner && seedOwner.id;
  if (!ownerId) {
    const r = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run('Sample Owner','sample.owner@hostelhomes.local',bcrypt.hashSync('SampleOwner123!',10),'Owner');
    ownerId = r.lastInsertRowid;
  }
  const insert = db.prepare('INSERT INTO properties(owner_id,title,type,rent,deposit,city,locality,facilities,description,gender,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const samples = [
    ['The Green Nest — Shared Stay','Hostel',6500,5000,'Pune','Wakad',['Wi-Fi','Laundry','Meals'],'Bright, comfortable shared stay for students and young professionals. Sample listing; verify before visiting.','Any','Approved'],
    ['Sunlit Studio Near Campus','Single Room',9200,10000,'Pune','Kothrud',['Furnished','Wi-Fi','Study desk'],'A compact single room with a study-friendly setup. Sample listing.','Any','Approved'],
    ['Courtyard Shared Flat','Flat',12000,15000,'Pune','Baner',['Kitchen','Balcony','Furnished'],'Shared-flat style listing with a balcony and common kitchen. Sample listing.','Any','Approved'],
    ['Maple House — Student Hostel','Hostel',4800,3000,'Pune','Viman Nagar',['Wi-Fi','Security','Meals'],'Budget-friendly sample hostel listing. Confirm availability with owner.','Any','Approved'],
    ['Quiet Corner Private Room','Single Room',14500,20000,'Pune','Aundh',['Attached bath','Furnished','Wi-Fi'],'Private-room sample listing. All details are illustrative.','Any','Approved'],
    ['The Shared House','Shared Room',5500,5000,'Pune','Hinjawadi',['Wi-Fi','Laundry','Parking'],'Shared-room example near a work hub. Sample information.','Any','Approved']
  ];
  const tx = db.transaction(rows => rows.forEach(x => insert.run(ownerId,x[0],x[1],x[2],x[3],x[4],x[5],JSON.stringify(x[6]),x[7],x[8],x[9])));
  tx(samples);
}
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminEmail && adminPassword && !db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail)) {
  db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run('Hostel Homes Admin',adminEmail,bcrypt.hashSync(adminPassword,12),'Admin');
}

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));
const safeUser = u => ({id:u.id,name:u.name,email:u.email,role:u.role});
function auth(req,res,next){
  const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):'';
  if(!token) return res.status(401).json({error:'Please log in first.'});
  try { const payload=jwt.verify(token,JWT_SECRET); const u=db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(payload.id); if(!u) return res.status(401).json({error:'Account not found.'}); req.user=u; next(); }
  catch { return res.status(401).json({error:'Session expired. Please log in again.'}); }
}
const role = (...roles) => (req,res,next) => roles.includes(req.user.role) ? next() : res.status(403).json({error:'You do not have permission for this action.'});
function propertyShape(p){return {...p,facilities:JSON.parse(p.facilities||'[]'),rent:Number(p.rent),deposit:Number(p.deposit),ownerName:p.owner_name||p.ownerName||'Property owner'};}
app.get('/api/health',(req,res)=>res.json({ok:true,service:'Hostel Homes API',database:'SQLite'}));
app.post('/api/auth/register', (req,res)=>{
  const {name,email,password,role:requestedRole='User'}=req.body||{};
  if(!name||!email||!password) return res.status(400).json({error:'Name, email and password are required.'});
  if(String(password).length<8) return res.status(400).json({error:'Password must be at least 8 characters.'});
  if(!['User','Owner'].includes(requestedRole)) return res.status(400).json({error:'Choose User or Owner account type.'});
  try { const r=db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(String(name).trim(),String(email).trim().toLowerCase(),bcrypt.hashSync(String(password),12),requestedRole); const user=db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(r.lastInsertRowid); const token=jwt.sign({id:user.id},JWT_SECRET,{expiresIn:'7d'}); res.status(201).json({user,token}); }
  catch(e){ if(String(e.code)==='SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({error:'Email already registered.'}); res.status(500).json({error:'Could not create account.'}); }
});
app.post('/api/auth/login',(req,res)=>{const {email,password}=req.body||{};const u=db.prepare('SELECT * FROM users WHERE email=?').get(String(email||'').trim().toLowerCase());if(!u||!bcrypt.compareSync(String(password||''),u.password_hash))return res.status(401).json({error:'Incorrect email or password.'});const token=jwt.sign({id:u.id},JWT_SECRET,{expiresIn:'7d'});res.json({user:safeUser(u),token});});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/properties',(req,res)=>{
  const {q='',type='All',maxRent='',sort='recommended',mine='false'}=req.query; let sql=`SELECT p.*,u.name owner_name FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.status='Approved' AND p.availability='Available'`; const args=[];
  if(q){sql+=' AND (p.city LIKE ? OR p.locality LIKE ? OR p.title LIKE ?)'; const v='%'+String(q).slice(0,100)+'%';args.push(v,v,v);}
  if(type&&type!=='All'){sql+=' AND p.type=?';args.push(type);}
  if(maxRent&&Number.isFinite(Number(maxRent))){sql+=' AND p.rent<=?';args.push(Number(maxRent));}
  if(sort==='low')sql+=' ORDER BY p.rent ASC';else if(sort==='high')sql+=' ORDER BY p.rent DESC';else sql+=' ORDER BY p.created_at DESC,p.id DESC';
  res.json({properties:db.prepare(sql).all(...args).map(propertyShape)});
});
app.get('/api/properties/:id',(req,res)=>{const p=db.prepare(`SELECT p.*,u.name owner_name FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.id=? AND p.status='Approved'`).get(req.params.id);if(!p)return res.status(404).json({error:'Property not found.'});res.json({property:propertyShape(p)});});
app.post('/api/properties',auth,role('Owner'),(req,res)=>{
 const b=req.body||{};const {title,type,rent,deposit=0,city,locality,facilities=[],description,phone='',gender='Any',image_url=''}=b;
 if(!title||!type||!rent||!city||!locality||!description)return res.status(400).json({error:'Please complete all required fields.'});
 if(!['Hostel','Single Room','Shared Room','Flat'].includes(type)||Number(rent)<=0||Number(rent)>10000000)return res.status(400).json({error:'Invalid property type or rent.'});
 const r=db.prepare(`INSERT INTO properties(owner_id,title,type,rent,deposit,city,locality,facilities,description,phone,gender,image_url,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'Pending')`).run(req.user.id,String(title).slice(0,120),type,Number(rent),Math.max(0,Number(deposit)||0),String(city).slice(0,80),String(locality).slice(0,100),JSON.stringify(Array.isArray(facilities)?facilities.slice(0,20):[]),String(description).slice(0,3000),String(phone).slice(0,30),String(gender).slice(0,20),String(image_url).slice(0,1000));res.status(201).json({message:'Listing submitted for admin approval.',id:r.lastInsertRowid});
});
app.get('/api/owner/properties',auth,role('Owner','Admin'),(req,res)=>{const rows=req.user.role==='Admin'?db.prepare('SELECT p.*,u.name owner_name FROM properties p JOIN users u ON u.id=p.owner_id ORDER BY p.created_at DESC').all():db.prepare('SELECT p.*,u.name owner_name FROM properties p JOIN users u ON u.id=p.owner_id WHERE owner_id=? ORDER BY p.created_at DESC').all(req.user.id);res.json({properties:rows.map(propertyShape)});});
app.patch('/api/properties/:id',auth,role('Owner','Admin'),(req,res)=>{const p=db.prepare('SELECT * FROM properties WHERE id=?').get(req.params.id);if(!p)return res.status(404).json({error:'Listing not found.'});if(req.user.role!=='Admin'&&p.owner_id!==req.user.id)return res.status(403).json({error:'You can only edit your own listings.'});const fields=['title','type','rent','deposit','city','locality','description','phone','gender','image_url'];const b=req.body||{};const set=[],args=[];for(const f of fields)if(b[f]!==undefined){set.push(`${f}=?`);args.push(['rent','deposit'].includes(f)?Number(b[f]):String(b[f]));}if(b.facilities!==undefined){set.push('facilities=?');args.push(JSON.stringify(Array.isArray(b.facilities)?b.facilities:[]));}if(req.user.role!=='Admin')set.push("status='Pending'");if(!set.length)return res.status(400).json({error:'No changes supplied.'});args.push(p.id);db.prepare(`UPDATE properties SET ${set.join(',')} WHERE id=?`).run(...args);res.json({message:req.user.role==='Admin'?'Listing updated.':'Changes saved; listing returned to pending approval.'});});
app.delete('/api/properties/:id',auth,role('Owner','Admin'),(req,res)=>{const p=db.prepare('SELECT * FROM properties WHERE id=?').get(req.params.id);if(!p)return res.status(404).json({error:'Listing not found.'});if(req.user.role!=='Admin'&&p.owner_id!==req.user.id)return res.status(403).json({error:'You can only delete your own listings.'});db.prepare('DELETE FROM properties WHERE id=?').run(p.id);res.json({message:'Listing deleted.'});});
app.get('/api/favourites',auth,(req,res)=>res.json({properties:db.prepare(`SELECT p.*,u.name owner_name FROM favourites f JOIN properties p ON p.id=f.property_id JOIN users u ON u.id=p.owner_id WHERE f.user_id=? ORDER BY f.created_at DESC`).all(req.user.id).map(propertyShape)}));
app.post('/api/favourites/:propertyId',auth,(req,res)=>{const p=db.prepare('SELECT id FROM properties WHERE id=? AND status=\'Approved\'').get(req.params.propertyId);if(!p)return res.status(404).json({error:'Approved listing not found.'});const exists=db.prepare('SELECT 1 FROM favourites WHERE user_id=? AND property_id=?').get(req.user.id,p.id);if(exists){db.prepare('DELETE FROM favourites WHERE user_id=? AND property_id=?').run(req.user.id,p.id);return res.json({saved:false});}db.prepare('INSERT INTO favourites(user_id,property_id) VALUES(?,?)').run(req.user.id,p.id);res.json({saved:true});});
app.post('/api/enquiries',auth,role('User'),(req,res)=>{const {property_id,move_date,message}=req.body||{};const p=db.prepare('SELECT id FROM properties WHERE id=? AND status=\'Approved\'').get(property_id);if(!p)return res.status(404).json({error:'Approved property not found.'});if(!move_date||!message)return res.status(400).json({error:'Move-in date and message are required.'});const r=db.prepare('INSERT INTO enquiries(property_id,user_id,move_date,message) VALUES(?,?,?,?)').run(p.id,req.user.id,String(move_date),String(message).slice(0,2000));res.status(201).json({message:'Enquiry saved successfully.',id:r.lastInsertRowid});});
app.get('/api/enquiries',auth,(req,res)=>{let rows;if(req.user.role==='Admin')rows=db.prepare(`SELECT e.*,p.title property_title,u.name user_name,u.email user_email,p.owner_id FROM enquiries e JOIN properties p ON p.id=e.property_id JOIN users u ON u.id=e.user_id ORDER BY e.created_at DESC`).all();else if(req.user.role==='Owner')rows=db.prepare(`SELECT e.*,p.title property_title,u.name user_name,u.email user_email,p.owner_id FROM enquiries e JOIN properties p ON p.id=e.property_id JOIN users u ON u.id=e.user_id WHERE p.owner_id=? ORDER BY e.created_at DESC`).all(req.user.id);else rows=db.prepare(`SELECT e.*,p.title property_title FROM enquiries e JOIN properties p ON p.id=e.property_id WHERE e.user_id=? ORDER BY e.created_at DESC`).all(req.user.id);res.json({enquiries:rows});});
app.patch('/api/enquiries/:id',(req,res,next)=>{auth(req,res,()=>{if(!['Owner','Admin'].includes(req.user.role))return res.status(403).json({error:'Owner or Admin only.'});const e=db.prepare('SELECT e.*,p.owner_id FROM enquiries e JOIN properties p ON p.id=e.property_id WHERE e.id=?').get(req.params.id);if(!e)return res.status(404).json({error:'Enquiry not found.'});if(req.user.role==='Owner'&&e.owner_id!==req.user.id)return res.status(403).json({error:'This enquiry is not for your property.'});const status=req.body&&req.body.status;if(!['Pending','Contacted','Closed'].includes(status))return res.status(400).json({error:'Invalid enquiry status.'});db.prepare('UPDATE enquiries SET status=? WHERE id=?').run(status,e.id);res.json({message:'Enquiry status updated.'});});});
app.get('/api/admin/overview',auth,role('Admin'),(req,res)=>res.json({users:db.prepare('SELECT COUNT(*) n FROM users').get().n,properties:db.prepare('SELECT COUNT(*) n FROM properties').get().n,pending:db.prepare("SELECT COUNT(*) n FROM properties WHERE status='Pending'").get().n,enquiries:db.prepare('SELECT COUNT(*) n FROM enquiries').get().n}));
app.get('/api/admin/properties',auth,role('Admin'),(req,res)=>res.json({properties:db.prepare('SELECT p.*,u.name owner_name FROM properties p JOIN users u ON u.id=p.owner_id ORDER BY CASE status WHEN \'Pending\' THEN 0 ELSE 1 END, p.created_at DESC').all().map(propertyShape)}));
app.patch('/api/admin/properties/:id/status',auth,role('Admin'),(req,res)=>{const status=req.body&&req.body.status;if(!['Approved','Rejected','Pending'].includes(status))return res.status(400).json({error:'Invalid status.'});const r=db.prepare('UPDATE properties SET status=? WHERE id=?').run(status,req.params.id);if(!r.changes)return res.status(404).json({error:'Listing not found.'});res.json({message:`Listing ${status.toLowerCase()}.`});});
app.use('/api',(req,res)=>res.status(404).json({error:'API route not found.'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Hostel Homes running at http://localhost:${PORT}`));
