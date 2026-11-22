require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite');
const { createEmailDelivery } = require('./email');

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
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL, kind TEXT NOT NULL, message TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,is_read,id);
`);

if (!db.prepare("PRAGMA table_info(properties)").all().some(column=>column.name==='image_urls')) db.exec("ALTER TABLE properties ADD COLUMN image_urls TEXT NOT NULL DEFAULT '[]'");
if (!db.prepare("PRAGMA table_info(properties)").all().some(column=>column.name==='image_labels')) db.exec("ALTER TABLE properties ADD COLUMN image_labels TEXT NOT NULL DEFAULT '[]'");
for(const column of ['latitude','longitude'])if(!db.prepare('PRAGMA table_info(properties)').all().some(c=>c.name===column))db.exec(`ALTER TABLE properties ADD COLUMN ${column} REAL`);
for(const [column,type] of Object.entries({email_sent_at:'TEXT',email_key:'TEXT',email_attempts:'INTEGER NOT NULL DEFAULT 0',email_next_attempt:'INTEGER NOT NULL DEFAULT 0'}))if(!db.prepare('PRAGMA table_info(notifications)').all().some(c=>c.name===column))db.exec(`ALTER TABLE notifications ADD COLUMN ${column} ${type}`);

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminEmail && adminPassword && !db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail)) {
  db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run('Hostel Homes Admin',adminEmail,bcrypt.hashSync(adminPassword,12),'Admin');
}

app.use(helmet({contentSecurityPolicy:false,referrerPolicy:{policy:'strict-origin-when-cross-origin'}}));
app.use(express.json({limit:'13mb'}));
app.use('/vendor/leaflet',express.static(path.join(path.dirname(require.resolve('leaflet/package.json')),'dist')));
app.use('/assets',express.static(path.join(__dirname,'assets')));
for (const file of ['app.js','app.css','login.js','maps.js','browse.js']) app.get('/'+file,(req,res)=>res.sendFile(path.join(__dirname,file)));
const safeUser = u => ({id:u.id,name:u.name,email:u.email,role:u.role});
function auth(req,res,next){
  const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):'';
  if(!token) return res.status(401).json({error:'Please log in first.'});
  try { const payload=jwt.verify(token,JWT_SECRET); const u=db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(payload.id); if(!u) return res.status(401).json({error:'Account not found.'}); req.user=u; }
  catch { return res.status(401).json({error:'Session expired. Please log in again.'}); }
  next();
}
const role = (...roles) => (req,res,next) => roles.includes(req.user.role) ? next() : res.status(403).json({error:'You do not have permission for this action.'});
function validLocation(latitude,longitude){return (latitude===null&&longitude===null)||(typeof latitude==='number'&&Number.isFinite(latitude)&&latitude>=-90&&latitude<=90&&typeof longitude==='number'&&Number.isFinite(longitude)&&longitude>=-180&&longitude<=180);}
function notify(userId,propertyId,kind,message){db.prepare('INSERT INTO notifications(user_id,property_id,kind,message) VALUES(?,?,?,?)').run(userId,propertyId,kind,message);}
function notifyAdmins(propertyId,message){db.prepare("INSERT INTO notifications(user_id,property_id,kind,message) SELECT id,?,'listing_review',? FROM users WHERE role='Admin'").run(propertyId,message);}
function validImage(value){return typeof value==='string'&&(value===''||(/^https?:\/\//i.test(value)&&value.length<=1000)||(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)&&value.length<=2000000));}
function validListingOwner(id,user){return Number.isSafeInteger(id)&&((user.role==='Admin'&&id===user.id)||!!db.prepare("SELECT id FROM users WHERE id=? AND role='Owner'").get(id));}
function validLabels(labels){return Array.isArray(labels)&&labels.length<=6&&labels.every(label=>['','Bedroom','Bathroom','Kitchen','Common area','Other'].includes(label));}
function propertyShape(p){return {...p,images:[p.image_url,...JSON.parse(p.image_urls||'[]')].filter(Boolean),image_labels:JSON.parse(p.image_labels||'[]'),facilities:JSON.parse(p.facilities||'[]'),rent:Number(p.rent),deposit:Number(p.deposit),ownerName:p.owner_name||p.ownerName||'Property owner'};}
const propertySelect = `SELECT p.*,u.name owner_name,u.role owner_role`;
app.get('/api/health',(req,res)=>res.json({ok:true,service:'Hostel Homes API',database:'SQLite'}));
app.post('/api/auth/register', (req,res)=>{
  const {name,email,password,role:requestedRole='User'}=req.body||{};
  if(typeof name!=='string'||!name.trim()||typeof email!=='string'||!email.trim()||typeof password!=='string'||!password) return res.status(400).json({error:'Name, email and password are required.'});
  if(String(password).length<8) return res.status(400).json({error:'Password must be at least 8 characters.'});
  if(!['User','Owner'].includes(requestedRole)) return res.status(400).json({error:'Choose User or Owner account type.'});
  try { const r=db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(String(name).trim(),String(email).trim().toLowerCase(),bcrypt.hashSync(String(password),12),requestedRole); const user=db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(r.lastInsertRowid); const token=jwt.sign({id:user.id},JWT_SECRET,{expiresIn:'7d'}); res.status(201).json({user,token}); }
  catch(e){ if(e.errcode===2067 || String(e.code)==='SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({error:'Email already registered.'}); res.status(500).json({error:'Could not create account.'}); }
});
app.post('/api/auth/login',(req,res)=>{const {email,password}=req.body||{};const u=db.prepare('SELECT * FROM users WHERE email=?').get(String(email||'').trim().toLowerCase());if(!u||!bcrypt.compareSync(String(password||''),u.password_hash))return res.status(401).json({error:'Incorrect email or password.'});const token=jwt.sign({id:u.id},JWT_SECRET,{expiresIn:'7d'});res.json({user:safeUser(u),token});});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/notifications',auth,(req,res)=>res.json({notifications:db.prepare('SELECT id,property_id,kind,message,is_read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id),unread_count:db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).n}));
app.patch('/api/notifications/read',auth,(req,res)=>{db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0').run(req.user.id);res.json({message:'All notifications marked as read.'});});
app.patch('/api/notifications/:id/read',auth,(req,res)=>{const result=db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id,req.user.id);if(!result.changes)return res.status(404).json({error:'Notification not found.'});res.json({message:'Notification marked as read.'});});
app.get('/api/properties',(req,res)=>{
  const {q='',type='All',maxRent='',sort='recommended',gender='',amenity=''}=req.query; let sql=`${propertySelect} FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.status='Approved' AND p.availability='Available'`; const args=[];
  if(q){sql+=' AND (p.city LIKE ? OR p.locality LIKE ? OR p.title LIKE ?)'; const v='%'+String(q).slice(0,100)+'%';args.push(v,v,v);}
  if(type&&type!=='All'){sql+=' AND p.type=?';args.push(type);}
  if(['Men','Women'].includes(gender)){sql+=" AND p.gender IN (?, 'Any')";args.push(gender);}
  if(['Wi-Fi','Meals','Laundry'].includes(amenity)){sql+=" AND EXISTS (SELECT 1 FROM json_each(p.facilities) WHERE LOWER(value)=LOWER(?))";args.push(amenity);}
  if(maxRent&&Number.isFinite(Number(maxRent))){sql+=' AND p.rent<=?';args.push(Number(maxRent));}
  if(sort==='low')sql+=' ORDER BY p.rent ASC';else if(sort==='high')sql+=' ORDER BY p.rent DESC';else sql+=' ORDER BY p.created_at DESC,p.id DESC';
  res.json({properties:db.prepare(sql).all(...args).map(propertyShape)});
});
app.get('/api/properties/:id',(req,res)=>{const p=db.prepare(`${propertySelect} FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.id=? AND p.status='Approved'`).get(req.params.id);if(!p)return res.status(404).json({error:'Property not found.'});res.json({property:propertyShape(p)});});
app.post('/api/properties',auth,role('Owner','Admin'),(req,res)=>{
 const b=req.body||{};const {title,type,rent,deposit=0,city,locality,facilities=[],description,phone='',gender='Any',image_url='',image_urls=[],image_labels=[],availability='Available',latitude=null,longitude=null}=b;
 const ownerId=req.user.role==='Admin'&&b.owner_id!==undefined?Number(b.owner_id):req.user.id;
 if(!validListingOwner(ownerId,req.user))return res.status(400).json({error:'Choose your own account or a registered property owner for this listing.'});
 if(!validLocation(latitude,longitude))return res.status(400).json({error:'Choose a valid map location, or remove the pin.'});
 if(!['Available','Unavailable'].includes(availability)||!validImage(image_url)||!validLabels(image_labels)||!Array.isArray(image_urls)||image_urls.length>5||!image_urls.every(v=>v!==''&&validImage(v)))return res.status(400).json({error:'Invalid availability or image.'});
 if(!type||!rent||[title,city,locality,description].some(v=>typeof v!=='string'||!v.trim()))return res.status(400).json({error:'Please complete all required fields.'});
 if(!['Hostel','Single Room','Shared Room','Flat'].includes(type)||!Number.isFinite(Number(rent))||Number(rent)<=0||Number(rent)>10000000||!Number.isFinite(Number(deposit))||Number(deposit)<0)return res.status(400).json({error:'Invalid property type or rent.'});
 const status=req.user.role==='Admin'?'Approved':'Pending';
 const r=db.transaction(()=>{
  const result=db.prepare(`INSERT INTO properties(owner_id,title,type,rent,deposit,city,locality,facilities,description,phone,gender,image_url,image_urls,image_labels,availability,status,latitude,longitude) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ownerId,String(title).slice(0,120),type,Number(rent),Math.max(0,Number(deposit)||0),String(city).slice(0,80),String(locality).slice(0,100),JSON.stringify(Array.isArray(facilities)?facilities.slice(0,20):[]),String(description).slice(0,3000),String(phone).slice(0,30),String(gender).slice(0,20),image_url,JSON.stringify(image_urls),JSON.stringify(image_labels),availability,status,latitude,longitude);
  if(status==='Pending')notifyAdmins(result.lastInsertRowid,`New listing awaiting review: ${String(title).slice(0,120)}`);
  else if(ownerId!==req.user.id)notify(ownerId,result.lastInsertRowid,'listing_status',`Your listing was published: ${String(title).slice(0,120)}`);
  return result;
 })();
 res.status(201).json({message:status==='Approved'?'Listing published.':'Listing submitted for admin approval.',id:r.lastInsertRowid});
});
app.get('/api/owner/properties',auth,role('Owner','Admin'),(req,res)=>{const rows=req.user.role==='Admin'?db.prepare(`${propertySelect} FROM properties p JOIN users u ON u.id=p.owner_id ORDER BY p.created_at DESC`).all():db.prepare(`${propertySelect} FROM properties p JOIN users u ON u.id=p.owner_id WHERE owner_id=? ORDER BY p.created_at DESC`).all(req.user.id);res.json({properties:rows.map(propertyShape)});});
app.patch('/api/properties/:id',auth,role('Owner','Admin'),(req,res)=>{
 const p=db.prepare('SELECT * FROM properties WHERE id=?').get(req.params.id);if(!p)return res.status(404).json({error:'Listing not found.'});
 if(req.user.role!=='Admin'&&p.owner_id!==req.user.id)return res.status(403).json({error:'You can only edit your own listings.'});
 const b=req.body||{};
 if(b.owner_id!==undefined&&(req.user.role!=='Admin'||!validListingOwner(Number(b.owner_id),req.user)))return res.status(400).json({error:'Only admins can assign a listing to themselves or a registered property owner.'});
 if(!validLocation(b.latitude===undefined?p.latitude:b.latitude,b.longitude===undefined?p.longitude:b.longitude))return res.status(400).json({error:'Choose a valid map location, or remove the pin.'});
 if((b.image_labels!==undefined&&!validLabels(b.image_labels))||(b.image_urls!==undefined&&(!Array.isArray(b.image_urls)||b.image_urls.length>5||!b.image_urls.every(v=>v!==''&&validImage(v))))||(b.image_url!==undefined&&!validImage(b.image_url))||(b.availability!==undefined&&!['Available','Unavailable'].includes(b.availability))||(b.type!==undefined&&!['Hostel','Single Room','Shared Room','Flat'].includes(b.type))||(b.rent!==undefined&&(!Number.isFinite(Number(b.rent))||Number(b.rent)<=0||Number(b.rent)>10000000))||(b.deposit!==undefined&&(!Number.isFinite(Number(b.deposit))||Number(b.deposit)<0))||['title','city','locality','description'].some(f=>b[f]!==undefined&&(typeof b[f]!=='string'||!b[f].trim())))return res.status(400).json({error:'Invalid listing details.'});
 const fields=['title','type','rent','deposit','city','locality','description','phone','gender','image_url','availability','latitude','longitude'];const set=[],args=[];
 if(b.owner_id!==undefined){set.push('owner_id=?');args.push(Number(b.owner_id));}
 for(const f of fields)if(b[f]!==undefined){set.push(`${f}=?`);args.push(['rent','deposit'].includes(f)?Number(b[f]):['latitude','longitude'].includes(f)?b[f]:String(b[f]));}
 for(const f of ['image_labels','image_urls','facilities'])if(b[f]!==undefined){set.push(`${f}=?`);args.push(JSON.stringify(Array.isArray(b[f])?b[f]:[]));}
 if(!set.length)return res.status(400).json({error:'No changes supplied.'});
 if(req.user.role!=='Admin')set.push("status='Pending'");args.push(p.id);
 db.transaction(()=>{
  db.prepare(`UPDATE properties SET ${set.join(',')} WHERE id=?`).run(...args);
  if(req.user.role==='Owner')notifyAdmins(p.id,`Listing updated and awaiting review: ${b.title??p.title}`);
  const ownerId=b.owner_id===undefined?p.owner_id:Number(b.owner_id);
  if(ownerId!==p.owner_id&&ownerId!==req.user.id)notify(ownerId,p.id,'listing_assigned',`A property was assigned to you: ${b.title??p.title}`);
 })();
 res.json({message:req.user.role==='Admin'?'Listing updated.':'Changes saved; listing returned to pending approval.'});
});
app.delete('/api/properties/:id',auth,role('Owner','Admin'),(req,res)=>{const p=db.prepare('SELECT * FROM properties WHERE id=?').get(req.params.id);if(!p)return res.status(404).json({error:'Listing not found.'});if(req.user.role!=='Admin'&&p.owner_id!==req.user.id)return res.status(403).json({error:'You can only delete your own listings.'});db.prepare('DELETE FROM properties WHERE id=?').run(p.id);res.json({message:'Listing deleted.'});});
app.get('/api/favourites',auth,(req,res)=>res.json({properties:db.prepare(`${propertySelect} FROM favourites f JOIN properties p ON p.id=f.property_id JOIN users u ON u.id=p.owner_id WHERE f.user_id=? AND p.status='Approved' ORDER BY f.created_at DESC`).all(req.user.id).map(propertyShape)}));
app.post('/api/favourites/:propertyId',auth,(req,res)=>{const p=db.prepare('SELECT id FROM properties WHERE id=? AND status=\'Approved\'').get(req.params.propertyId);if(!p)return res.status(404).json({error:'Approved listing not found.'});const exists=db.prepare('SELECT 1 FROM favourites WHERE user_id=? AND property_id=?').get(req.user.id,p.id);if(exists){db.prepare('DELETE FROM favourites WHERE user_id=? AND property_id=?').run(req.user.id,p.id);return res.json({saved:false});}db.prepare('INSERT INTO favourites(user_id,property_id) VALUES(?,?)').run(req.user.id,p.id);res.json({saved:true});});
app.get('/api/properties/:id/contact',auth,role('User'),(req,res)=>{
  const p=db.prepare(`SELECT p.title,p.status,p.availability,p.phone,u.name,u.email,u.role FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.id=?`).get(req.params.id);
  if(!p||p.status!=='Approved'||p.availability!=='Available')return res.status(404).json({error:'Available property not found.'});
  if(!['Owner','Admin'].includes(p.role))return res.status(409).json({error:'The property owner has not been assigned yet. Please check this listing later.'});
  res.json({owner:{name:p.name,email:p.email,phone:p.phone},property_title:p.title});
});
app.post('/api/enquiries',auth,role('User'),(req,res)=>{
  const {property_id,move_date,message}=req.body||{};
  if(!Number.isSafeInteger(Number(property_id))||Number(property_id)<=0)return res.status(400).json({error:'Valid property is required.'});
  const p=db.prepare(`SELECT p.id,p.owner_id,p.title,u.role FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.id=? AND p.status='Approved' AND p.availability='Available'`).get(Number(property_id));
  if(!p)return res.status(404).json({error:'Available property not found.'});
  if(!['Owner','Admin'].includes(p.role))return res.status(409).json({error:'The property owner has not been assigned yet.'});
  if(typeof move_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(move_date)||typeof message!=='string'||!message.trim())return res.status(400).json({error:'Move-in date and message are required.'});
  const r=db.transaction(()=>{const result=db.prepare('INSERT INTO enquiries(property_id,user_id,move_date,message) VALUES(?,?,?,?)').run(p.id,req.user.id,move_date,message.trim().slice(0,2000));notify(p.owner_id,p.id,'enquiry',`New student enquiry for ${p.title}`);return result;})();
  res.status(201).json({message:'Enquiry sent to the property owner.',id:r.lastInsertRowid});
});
app.get('/api/enquiries',auth,role('Owner','User','Admin'),(req,res)=>{
  const rows=req.user.role!=='User'
    ?db.prepare(`SELECT e.*,p.title property_title,u.name user_name,u.email user_email,p.owner_id FROM enquiries e JOIN properties p ON p.id=e.property_id JOIN users u ON u.id=e.user_id WHERE p.owner_id=? ORDER BY e.created_at DESC,e.id DESC`).all(req.user.id)
    :db.prepare(`SELECT e.*,p.title property_title FROM enquiries e JOIN properties p ON p.id=e.property_id WHERE e.user_id=? ORDER BY e.created_at DESC,e.id DESC`).all(req.user.id);
  res.json({enquiries:rows});
});
app.patch('/api/enquiries/:id',auth,role('Owner','Admin'),(req,res)=>{
  const e=db.prepare('SELECT e.*,p.owner_id,p.title property_title FROM enquiries e JOIN properties p ON p.id=e.property_id WHERE e.id=?').get(req.params.id);
  if(!e)return res.status(404).json({error:'Enquiry not found.'});
  if(e.owner_id!==req.user.id)return res.status(403).json({error:'This enquiry is not for your property.'});
  const status=req.body&&req.body.status;
  if(!['Pending','Contacted','Closed'].includes(status))return res.status(400).json({error:'Invalid enquiry status.'});
  db.transaction(()=>{db.prepare('UPDATE enquiries SET status=? WHERE id=?').run(status,e.id);if(status!==e.status)notify(e.user_id,e.property_id,'enquiry_status',`Your enquiry for ${e.property_title} is now ${status.toLowerCase()}.`);})();res.json({message:'Enquiry status updated.'});
});
app.get('/api/admin/owners',auth,role('Admin'),(req,res)=>res.json({owners:db.prepare("SELECT id,name,email FROM users WHERE role='Owner' ORDER BY name,id").all()}));
app.get('/api/admin/overview',auth,role('Admin'),(req,res)=>res.json({users:db.prepare('SELECT COUNT(*) n FROM users').get().n,properties:db.prepare('SELECT COUNT(*) n FROM properties').get().n,pending:db.prepare("SELECT COUNT(*) n FROM properties WHERE status='Pending'").get().n,enquiries:db.prepare('SELECT COUNT(*) n FROM enquiries').get().n}));
app.get('/api/admin/properties',auth,role('Admin'),(req,res)=>res.json({properties:db.prepare(`${propertySelect} FROM properties p JOIN users u ON u.id=p.owner_id ORDER BY CASE status WHEN 'Pending' THEN 0 ELSE 1 END, p.created_at DESC`).all().map(propertyShape)}));
app.patch('/api/admin/properties/:id/status',auth,role('Admin'),(req,res)=>{
 const status=req.body&&req.body.status;if(!['Approved','Rejected','Pending'].includes(status))return res.status(400).json({error:'Invalid status.'});
 const p=db.prepare('SELECT p.*,u.role owner_role FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.id=?').get(req.params.id);
 if(!p)return res.status(404).json({error:'Listing not found.'});
 if(status==='Approved'&&!['Owner','Admin'].includes(p.owner_role))return res.status(400).json({error:'Assign a property owner before publishing.'});
 db.transaction(()=>{db.prepare('UPDATE properties SET status=? WHERE id=?').run(status,p.id);if(status!==p.status&&p.owner_id!==req.user.id)notify(p.owner_id,p.id,'listing_status',`Your listing ${p.title} is now ${status.toLowerCase()}.`);})();
 res.json({message:`Listing ${status.toLowerCase()}.`});
});
app.use('/api',(req,res)=>res.status(404).json({error:'API route not found.'}));
app.get('/login',(req,res)=>res.sendFile(path.join(__dirname,'login.html')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  if(error.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON request.'});
  if(error.type==='entity.too.large')return res.status(413).json({error:'Upload too large. Use up to 6 photos under 1.4 MB each.'});
  console.error(error);
  res.status(500).json({error:'Could not complete the request. Please try again.'});
});
app.listen(PORT,()=>{
  console.log(`Hostel Homes running at http://localhost:${PORT}`);
  if(process.env.BREVO_API_KEY&&process.env.EMAIL_FROM){
    const delivery=createEmailDelivery(db,{apiKey:process.env.BREVO_API_KEY,from:process.env.EMAIL_FROM,appUrl:process.env.APP_URL||`http://localhost:${PORT}`});
    const flush=()=>delivery.flush().catch(()=>console.error('Could not process the notification email queue.'));
    flush();setInterval(flush,30000).unref();
  }
});
