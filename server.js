require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createDatabase, initializeDatabase } = require('./database');
const { createEmailDelivery } = require('./email');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret-before-deployment';
let db;
const route = handler => (req,res,next) => Promise.resolve().then(() => handler(req,res,next)).catch(next);
function requestError(status,message){return Object.assign(Error(message),{status});}

app.use(helmet({contentSecurityPolicy:false,referrerPolicy:{policy:'strict-origin-when-cross-origin'}}));
app.use(express.json({limit:'13mb'}));
app.use('/vendor/leaflet',express.static(path.join(path.dirname(require.resolve('leaflet/package.json')),'dist')));
app.use('/assets',express.static(path.join(__dirname,'assets')));
for (const file of ['app.js','app.css','login.js','maps.js','browse.js']) app.get('/'+file,route(async(req,res)=>res.sendFile(path.join(__dirname,file))));
const safeUser = u => ({id:u.id,name:u.name,email:u.email,role:u.role});
const auth = route(async(req,res,next)=>{
  const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):'';
  if(!token) return res.status(401).json({error:'Please log in first.'});
  let payload;
  try { payload=jwt.verify(token,JWT_SECRET); }
  catch { return res.status(401).json({error:'Session expired. Please log in again.'}); }
  const u=await db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(payload.id);
  if(!u)return res.status(401).json({error:'Account not found.'});req.user=u;
  next();
});
const role = (...roles) => (req,res,next) => roles.includes(req.user.role) ? next() : res.status(403).json({error:'You do not have permission for this action.'});
function validLocation(latitude,longitude){return (latitude===null&&longitude===null)||(typeof latitude==='number'&&Number.isFinite(latitude)&&latitude>=-90&&latitude<=90&&typeof longitude==='number'&&Number.isFinite(longitude)&&longitude>=-180&&longitude<=180);}
async function notify(userId,propertyId,kind,message,connection=db){await connection.prepare('INSERT INTO notifications(user_id,property_id,kind,message) VALUES(?,?,?,?)').run(userId,propertyId,kind,message);}
async function notifyAdmins(propertyId,message,connection=db){await connection.prepare("INSERT INTO notifications(user_id,property_id,kind,message) SELECT id,?,'listing_review',? FROM users WHERE role='Admin'").run(propertyId,message);}
function validImage(value){return typeof value==='string'&&(value===''||(/^https?:\/\//i.test(value)&&value.length<=1000)||(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)&&value.length<=2000000));}
async function validListingOwner(id,user){return Number.isSafeInteger(id)&&id>0&&id<=2147483647&&((user.role==='Admin'&&id===user.id)||!!(await db.prepare("SELECT id FROM users WHERE id=? AND role='Owner'").get(id)));}
function validLabels(labels){return Array.isArray(labels)&&labels.length<=6&&labels.every(label=>['','Bedroom','Bathroom','Kitchen','Common area','Other'].includes(label));}
function propertyShape(p){return {...p,images:[p.image_url,...JSON.parse(p.image_urls||'[]')].filter(Boolean),image_labels:JSON.parse(p.image_labels||'[]'),facilities:JSON.parse(p.facilities||'[]'),rent:Number(p.rent),deposit:Number(p.deposit),ownerName:p.owner_name||p.ownerName||'Property owner'};}
const propertySelect = `SELECT p.*,u.name owner_name,u.role owner_role`;
for(const name of ['id','propertyId'])app.param(name,(req,res,next,value)=>Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<=2147483647?next():res.status(404).json({error:'Record not found.'}));
app.get('/api/health',route(async(req,res)=>{await db.prepare('SELECT 1').get();res.json({ok:true,service:'Hostel Homes API',database:db.dialect});}));
app.post('/api/auth/register', route(async(req,res)=>{
  const {name,email,password,role:requestedRole='User'}=req.body||{};
  if(typeof name!=='string'||!name.trim()||typeof email!=='string'||!email.trim()||typeof password!=='string'||!password) return res.status(400).json({error:'Name, email and password are required.'});
  if(String(password).length<8) return res.status(400).json({error:'Password must be at least 8 characters.'});
  if(!['User','Owner'].includes(requestedRole)) return res.status(400).json({error:'Choose User or Owner account type.'});
  try { const r=(await db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?) RETURNING id').run(String(name).trim(),String(email).trim().toLowerCase(),bcrypt.hashSync(String(password),12),requestedRole)); const user=(await db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(r.lastInsertRowid)); const token=jwt.sign({id:user.id},JWT_SECRET,{expiresIn:'7d'}); res.status(201).json({user,token}); }
  catch(e){ if(e.errcode===2067 || String(e.code)==='SQLITE_CONSTRAINT_UNIQUE'||e.code==='23505') return res.status(409).json({error:'Email already registered.'}); throw e; }
}));
app.post('/api/auth/login',route(async(req,res)=>{const {email,password}=req.body||{};const u=(await db.prepare('SELECT * FROM users WHERE LOWER(email)=?').get(String(email||'').trim().toLowerCase()));if(!u||!bcrypt.compareSync(String(password||''),u.password_hash))return res.status(401).json({error:'Incorrect email or password.'});const token=jwt.sign({id:u.id},JWT_SECRET,{expiresIn:'7d'});res.json({user:safeUser(u),token});}));
app.get('/api/auth/me',auth,route(async(req,res)=>res.json({user:req.user})));
app.get('/api/notifications',auth,route(async(req,res)=>res.json({notifications:(await db.prepare('SELECT id,property_id,kind,is_read,message,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id)),unread_count:Number((await db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id)).n)})));
app.patch('/api/notifications/read',auth,route(async(req,res)=>{(await db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0').run(req.user.id));res.json({message:'All notifications marked as read.'});}));
app.patch('/api/notifications/:id/read',auth,route(async(req,res)=>{const result=(await db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id,req.user.id));if(!result.changes)return res.status(404).json({error:'Notification not found.'});res.json({message:'Notification marked as read.'});}));
app.get('/api/properties',route(async(req,res)=>{
  const {q='',type='All',maxRent='',sort='recommended',gender='',amenity=''}=req.query; let sql=`${propertySelect} FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.status='Approved' AND p.availability='Available'`; const args=[];
  if(q){sql+=' AND (LOWER(p.city) LIKE LOWER(?) OR LOWER(p.locality) LIKE LOWER(?) OR LOWER(p.title) LIKE LOWER(?))'; const v='%'+String(q).slice(0,100)+'%';args.push(v,v,v);}
  if(type&&type!=='All'){sql+=' AND p.type=?';args.push(type);}
  if(['Men','Women'].includes(gender)){sql+=" AND p.gender IN (?, 'Any')";args.push(gender);}
  if(['Wi-Fi','Meals','Laundry'].includes(amenity)){sql+=db.dialect==='PostgreSQL'?" AND EXISTS (SELECT 1 FROM json_array_elements_text(p.facilities::json) AS amenity(value) WHERE LOWER(value)=LOWER(?))":" AND EXISTS (SELECT 1 FROM json_each(p.facilities) WHERE LOWER(value)=LOWER(?))";args.push(amenity);}
  if(maxRent&&Number.isFinite(Number(maxRent))){sql+=' AND p.rent<=?';args.push(Number(maxRent));}
  if(sort==='low')sql+=' ORDER BY p.rent ASC';else if(sort==='high')sql+=' ORDER BY p.rent DESC';else sql+=' ORDER BY p.created_at DESC,p.id DESC';
  res.json({properties:(await db.prepare(sql).all(...args)).map(propertyShape)});
}));
app.get('/api/properties/:id',route(async(req,res)=>{const p=(await db.prepare(`${propertySelect} FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.id=? AND p.status='Approved'`).get(req.params.id));if(!p)return res.status(404).json({error:'Property not found.'});res.json({property:propertyShape(p)});}));
app.post('/api/properties',auth,role('Owner','Admin'),route(async(req,res)=>{
 const b=req.body||{};const {title,type,rent,deposit=0,city,locality,facilities=[],description,phone='',gender='Any',image_url='',image_urls=[],image_labels=[],availability='Available',latitude=null,longitude=null}=b;
 const ownerId=req.user.role==='Admin'&&b.owner_id!==undefined?Number(b.owner_id):req.user.id;
 if(!(await validListingOwner(ownerId,req.user)))return res.status(400).json({error:'Choose your own account or a registered property owner for this listing.'});
 if(!validLocation(latitude,longitude))return res.status(400).json({error:'Choose a valid map location, or remove the pin.'});
 if(!['Available','Unavailable'].includes(availability)||!validImage(image_url)||!validLabels(image_labels)||!Array.isArray(image_urls)||image_urls.length>5||!image_urls.every(v=>v!==''&&validImage(v)))return res.status(400).json({error:'Invalid availability or image.'});
 if(!type||!rent||[title,city,locality,description].some(v=>typeof v!=='string'||!v.trim()))return res.status(400).json({error:'Please complete all required fields.'});
 if(!['Hostel','Single Room','Shared Room','Flat'].includes(type)||!Number.isFinite(Number(rent))||Number(rent)<=0||Number(rent)>10000000||!Number.isFinite(Number(deposit))||Number(deposit)<0)return res.status(400).json({error:'Invalid property type or rent.'});
 const status=req.user.role==='Admin'?'Approved':'Pending';
 const r=await db.transaction(async tx=>{
  const result=await tx.prepare(`INSERT INTO properties(owner_id,title,type,rent,deposit,city,locality,facilities,description,phone,gender,image_url,image_urls,image_labels,availability,status,latitude,longitude) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).run(ownerId,String(title).slice(0,120),type,Number(rent),Math.max(0,Number(deposit)||0),String(city).slice(0,80),String(locality).slice(0,100),JSON.stringify(Array.isArray(facilities)?facilities.slice(0,20):[]),String(description).slice(0,3000),String(phone).slice(0,30),String(gender).slice(0,20),image_url,JSON.stringify(image_urls),JSON.stringify(image_labels),availability,status,latitude,longitude);
  if(status==='Pending')await notifyAdmins(result.lastInsertRowid,`New listing awaiting review: ${String(title).slice(0,120)}`,tx);
  else if(ownerId!==req.user.id)await notify(ownerId,result.lastInsertRowid,'listing_status',`Your listing was published: ${String(title).slice(0,120)}`,tx);
  return result;
 });
 res.status(201).json({message:status==='Approved'?'Listing published.':'Listing submitted for admin approval.',id:r.lastInsertRowid});
}));
app.get('/api/owner/properties',auth,role('Owner','Admin'),route(async(req,res)=>{const rows=req.user.role==='Admin'?(await db.prepare(`${propertySelect} FROM properties p JOIN users u ON u.id=p.owner_id ORDER BY p.created_at DESC`).all()):(await db.prepare(`${propertySelect} FROM properties p JOIN users u ON u.id=p.owner_id WHERE owner_id=? ORDER BY p.created_at DESC`).all(req.user.id));res.json({properties:rows.map(propertyShape)});}));
app.patch('/api/properties/:id',auth,role('Owner','Admin'),route(async(req,res)=>{
 const p=(await db.prepare('SELECT * FROM properties WHERE id=?').get(req.params.id));if(!p)return res.status(404).json({error:'Listing not found.'});
 if(req.user.role!=='Admin'&&p.owner_id!==req.user.id)return res.status(403).json({error:'You can only edit your own listings.'});
 const b=req.body||{};
 if(b.owner_id!==undefined&&(req.user.role!=='Admin'||!(await validListingOwner(Number(b.owner_id),req.user))))return res.status(400).json({error:'Only admins can assign a listing to themselves or a registered property owner.'});
 if(!validLocation(b.latitude===undefined?p.latitude:b.latitude,b.longitude===undefined?p.longitude:b.longitude))return res.status(400).json({error:'Choose a valid map location, or remove the pin.'});
 if((b.image_labels!==undefined&&!validLabels(b.image_labels))||(b.image_urls!==undefined&&(!Array.isArray(b.image_urls)||b.image_urls.length>5||!b.image_urls.every(v=>v!==''&&validImage(v))))||(b.image_url!==undefined&&!validImage(b.image_url))||(b.availability!==undefined&&!['Available','Unavailable'].includes(b.availability))||(b.type!==undefined&&!['Hostel','Single Room','Shared Room','Flat'].includes(b.type))||(b.rent!==undefined&&(!Number.isFinite(Number(b.rent))||Number(b.rent)<=0||Number(b.rent)>10000000))||(b.deposit!==undefined&&(!Number.isFinite(Number(b.deposit))||Number(b.deposit)<0))||['title','city','locality','description'].some(f=>b[f]!==undefined&&(typeof b[f]!=='string'||!b[f].trim())))return res.status(400).json({error:'Invalid listing details.'});
 const fields=['title','type','rent','deposit','city','locality','description','phone','gender','image_url','availability','latitude','longitude'];const set=[],args=[];
 if(b.owner_id!==undefined){set.push('owner_id=?');args.push(Number(b.owner_id));}
 for(const f of fields)if(b[f]!==undefined){set.push(`${f}=?`);args.push(['rent','deposit'].includes(f)?Number(b[f]):['latitude','longitude'].includes(f)?b[f]:String(b[f]));}
 for(const f of ['image_labels','image_urls','facilities'])if(b[f]!==undefined){set.push(`${f}=?`);args.push(JSON.stringify(Array.isArray(b[f])?b[f]:[]));}
 if(!set.length)return res.status(400).json({error:'No changes supplied.'});
 if(req.user.role!=='Admin')set.push("status='Pending'");args.push(p.id);
 await db.transaction(async tx=>{
  const current=await tx.prepare('SELECT * FROM properties WHERE id=?'+(db.dialect==='PostgreSQL'?' FOR UPDATE':'')).get(p.id);
  if(!current)throw requestError(404,'Listing not found.');
  if(req.user.role!=='Admin'&&current.owner_id!==req.user.id)throw requestError(403,'You can only edit your own listings.');
  if(!validLocation(b.latitude===undefined?current.latitude:b.latitude,b.longitude===undefined?current.longitude:b.longitude))throw requestError(400,'Choose a valid map location, or remove the pin.');
  await tx.prepare(`UPDATE properties SET ${set.join(',')} WHERE id=?`).run(...args);
  if(req.user.role==='Owner')await notifyAdmins(p.id,`Listing updated and awaiting review: ${b.title??current.title}`,tx);
  const ownerId=b.owner_id===undefined?current.owner_id:Number(b.owner_id);
  if(ownerId!==current.owner_id&&ownerId!==req.user.id)await notify(ownerId,p.id,'listing_assigned',`A property was assigned to you: ${b.title??current.title}`,tx);
 });
 res.json({message:req.user.role==='Admin'?'Listing updated.':'Changes saved; listing returned to pending approval.'});
}));
app.delete('/api/properties/:id',auth,role('Owner','Admin'),route(async(req,res)=>{
 await db.transaction(async tx=>{
  const p=await tx.prepare('SELECT * FROM properties WHERE id=?'+(db.dialect==='PostgreSQL'?' FOR UPDATE':'')).get(req.params.id);
  if(!p)throw requestError(404,'Listing not found.');
  if(req.user.role!=='Admin'&&p.owner_id!==req.user.id)throw requestError(403,'You can only delete your own listings.');
  await tx.prepare('DELETE FROM properties WHERE id=?').run(p.id);
 });
 res.json({message:'Listing deleted.'});
}));
app.get('/api/favourites',auth,route(async(req,res)=>res.json({properties:(await db.prepare(`${propertySelect} FROM favourites f JOIN properties p ON p.id=f.property_id JOIN users u ON u.id=p.owner_id WHERE f.user_id=? AND p.status='Approved' ORDER BY f.created_at DESC`).all(req.user.id)).map(propertyShape)})));
app.post('/api/favourites/:propertyId',auth,route(async(req,res)=>{
 const saved=await db.transaction(async tx=>{
  const p=await tx.prepare("SELECT id FROM properties WHERE id=? AND status='Approved'"+(db.dialect==='PostgreSQL'?' FOR UPDATE':'')).get(req.params.propertyId);
  if(!p)throw requestError(404,'Approved listing not found.');
  const exists=await tx.prepare('SELECT 1 FROM favourites WHERE user_id=? AND property_id=?').get(req.user.id,p.id);
  if(exists){await tx.prepare('DELETE FROM favourites WHERE user_id=? AND property_id=?').run(req.user.id,p.id);return false;}
  await tx.prepare('INSERT INTO favourites(user_id,property_id) VALUES(?,?)').run(req.user.id,p.id);return true;
 });
 res.json({saved});
}));
app.get('/api/properties/:id/contact',auth,role('User'),route(async(req,res)=>{
  const p=(await db.prepare(`SELECT p.title,p.status,p.availability,p.phone,u.name,u.email,u.role FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.id=?`).get(req.params.id));
  if(!p||p.status!=='Approved'||p.availability!=='Available')return res.status(404).json({error:'Available property not found.'});
  if(!['Owner','Admin'].includes(p.role))return res.status(409).json({error:'The property owner has not been assigned yet. Please check this listing later.'});
  res.json({owner:{name:p.name,email:p.email,phone:p.phone},property_title:p.title});
}));
app.post('/api/enquiries',auth,role('User'),route(async(req,res)=>{
  const {property_id,move_date,message}=req.body||{};
  if(!Number.isSafeInteger(Number(property_id))||Number(property_id)<=0||Number(property_id)>2147483647)return res.status(400).json({error:'Valid property is required.'});
  if(typeof move_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(move_date)||typeof message!=='string'||!message.trim())return res.status(400).json({error:'Move-in date and message are required.'});
  const r=await db.transaction(async tx=>{
    const p=await tx.prepare("SELECT p.id,p.owner_id,p.title,u.role FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.id=? AND p.status='Approved' AND p.availability='Available'"+(db.dialect==='PostgreSQL'?' FOR SHARE OF p':'')).get(Number(property_id));
    if(!p)throw requestError(404,'Available property not found.');
    if(!['Owner','Admin'].includes(p.role))throw requestError(409,'The property owner has not been assigned yet.');
    const result=await tx.prepare('INSERT INTO enquiries(property_id,user_id,move_date,message) VALUES(?,?,?,?) RETURNING id').run(p.id,req.user.id,move_date,message.trim().slice(0,2000));
    await notify(p.owner_id,p.id,'enquiry',`New student enquiry for ${p.title}`,tx);return result;
  });
  res.status(201).json({message:'Enquiry sent to the property owner.',id:r.lastInsertRowid});
}));
app.get('/api/enquiries',auth,role('Owner','User','Admin'),route(async(req,res)=>{
  const rows=req.user.role!=='User'
    ?(await db.prepare(`SELECT e.*,p.title property_title,u.name user_name,u.email user_email,p.owner_id FROM enquiries e JOIN properties p ON p.id=e.property_id JOIN users u ON u.id=e.user_id WHERE p.owner_id=? ORDER BY e.created_at DESC,e.id DESC`).all(req.user.id))
    :(await db.prepare(`SELECT e.*,p.title property_title FROM enquiries e JOIN properties p ON p.id=e.property_id WHERE e.user_id=? ORDER BY e.created_at DESC,e.id DESC`).all(req.user.id));
  res.json({enquiries:rows});
}));
app.patch('/api/enquiries/:id',auth,role('Owner','Admin'),route(async(req,res)=>{
  const e=(await db.prepare('SELECT e.*,p.owner_id,p.title property_title FROM enquiries e JOIN properties p ON p.id=e.property_id WHERE e.id=?').get(req.params.id));
  if(!e)return res.status(404).json({error:'Enquiry not found.'});
  if(e.owner_id!==req.user.id)return res.status(403).json({error:'This enquiry is not for your property.'});
  const status=req.body&&req.body.status;
  if(!['Pending','Contacted','Closed'].includes(status))return res.status(400).json({error:'Invalid enquiry status.'});
  await db.transaction(async tx=>{
    const current=await tx.prepare('SELECT e.*,p.owner_id,p.title property_title FROM enquiries e JOIN properties p ON p.id=e.property_id WHERE e.id=?'+(db.dialect==='PostgreSQL'?' FOR UPDATE OF e,p':'')).get(e.id);
    if(!current)throw requestError(404,'Enquiry not found.');
    if(current.owner_id!==req.user.id)throw requestError(403,'This enquiry is not for your property.');
    await tx.prepare('UPDATE enquiries SET status=? WHERE id=?').run(status,e.id);
    if(status!==current.status)await notify(current.user_id,current.property_id,'enquiry_status',`Your enquiry for ${current.property_title} is now ${status.toLowerCase()}.`,tx);
  });res.json({message:'Enquiry status updated.'});
}));
app.get('/api/admin/owners',auth,role('Admin'),route(async(req,res)=>res.json({owners:(await db.prepare("SELECT id,name,email FROM users WHERE role='Owner' ORDER BY name,id").all())})));
app.get('/api/admin/overview',auth,role('Admin'),route(async(req,res)=>res.json({users:Number((await db.prepare('SELECT COUNT(*) n FROM users').get()).n),properties:Number((await db.prepare('SELECT COUNT(*) n FROM properties').get()).n),pending:Number((await db.prepare("SELECT COUNT(*) n FROM properties WHERE status='Pending'").get()).n),enquiries:Number((await db.prepare('SELECT COUNT(*) n FROM enquiries').get()).n)})));
app.get('/api/admin/properties',auth,role('Admin'),route(async(req,res)=>res.json({properties:(await db.prepare(`${propertySelect} FROM properties p JOIN users u ON u.id=p.owner_id ORDER BY CASE status WHEN 'Pending' THEN 0 ELSE 1 END, p.created_at DESC`).all()).map(propertyShape)})));
app.patch('/api/admin/properties/:id/status',auth,role('Admin'),route(async(req,res)=>{
 const status=req.body&&req.body.status;if(!['Approved','Rejected','Pending'].includes(status))return res.status(400).json({error:'Invalid status.'});
 const p=(await db.prepare('SELECT p.*,u.role owner_role FROM properties p JOIN users u ON u.id=p.owner_id WHERE p.id=?').get(req.params.id));
 if(!p)return res.status(404).json({error:'Listing not found.'});
 if(status==='Approved'&&!['Owner','Admin'].includes(p.owner_role))return res.status(400).json({error:'Assign a property owner before publishing.'});
 await db.transaction(async tx=>{
  const current=await tx.prepare('SELECT * FROM properties WHERE id=?'+(db.dialect==='PostgreSQL'?' FOR UPDATE':'')).get(p.id);
  if(!current)throw requestError(404,'Listing not found.');
  await tx.prepare('UPDATE properties SET status=? WHERE id=?').run(status,p.id);
  if(status!==current.status&&current.owner_id!==req.user.id)await notify(current.owner_id,p.id,'listing_status',`Your listing ${current.title} is now ${status.toLowerCase()}.`,tx);
 });
 res.json({message:`Listing ${status.toLowerCase()}.`});
}));
app.use('/api',route(async(req,res)=>res.status(404).json({error:'API route not found.'})));
app.get('/login',route(async(req,res)=>res.sendFile(path.join(__dirname,'login.html'))));
app.get('*',route(async(req,res)=>res.sendFile(path.join(__dirname,'index.html'))));
app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  if(error.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON request.'});
  if(error.type==='entity.too.large')return res.status(413).json({error:'Upload too large. Use up to 6 photos under 1.4 MB each.'});
  if([400,403,404,409].includes(error.status))return res.status(error.status).json({error:error.message});
  console.error(`Request failed (${error.code || error.name}).`);
  res.status(500).json({error:'Could not complete the request. Please try again.'});
});
async function start(){
 if((process.env.RENDER||process.env.NODE_ENV==='production')&&!process.env.DATABASE_URL)throw Error('DATABASE_URL is required for deployment.');
 db=createDatabase();
 await initializeDatabase(db);
 const adminEmail=process.env.ADMIN_EMAIL?.trim().toLowerCase(),adminPassword=process.env.ADMIN_PASSWORD;
 if(adminEmail&&adminPassword)await db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run('Hostel Homes Admin',adminEmail,bcrypt.hashSync(adminPassword,12),'Admin');
 let emailTimer;
 const server=app.listen(PORT,()=>{
  console.log(`Hostel Homes running at http://localhost:${PORT}`);
  if(process.env.BREVO_API_KEY&&process.env.EMAIL_FROM){
    const delivery=createEmailDelivery(db,{apiKey:process.env.BREVO_API_KEY,from:process.env.EMAIL_FROM,appUrl:process.env.APP_URL||`http://localhost:${PORT}`});
    const flush=()=>delivery.flush().catch(()=>console.error('Could not process the notification email queue.'));
    flush();emailTimer=setInterval(flush,30000);emailTimer.unref();
  }
 });
 const shutdown=()=>{clearInterval(emailTimer);server.close(()=>db.close().then(()=>process.exit(0)));};
 process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
start().catch(async error=>{console.error(`Could not start Hostel Homes (${error.code||error.name}). Check DATABASE_URL and database access.`);if(db)await db.close();process.exitCode=1;});
