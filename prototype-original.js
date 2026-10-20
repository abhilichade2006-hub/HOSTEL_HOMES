const initialProperties = [
  {id:"p1",title:"The Green Nest — Shared Stay",type:"Hostel",rent:6500,city:"Pune",locality:"Wakad",facilities:["Wi-Fi","Laundry","Meals"],availability:"Available",status:"Approved",owner:"Demo Owner",phone:"",description:"A bright, comfortable shared stay designed for students and young professionals. This is illustrative demo data, not a verified property.",color:0,deposit:5000,gender:"Any"},
  {id:"p2",title:"Sunlit Studio Near Campus",type:"Single Room",rent:9200,city:"Pune",locality:"Kothrud",facilities:["Furnished","Wi-Fi","Study desk"],availability:"Available",status:"Approved",owner:"Demo Owner",phone:"",description:"A compact single room with a calm study-friendly setup. Sample listing only; confirm all details before making real-world decisions.",color:1,deposit:10000,gender:"Any"},
  {id:"p3",title:"Courtyard Shared Flat",type:"Flat",rent:12000,city:"Pune",locality:"Baner",facilities:["Kitchen","Balcony","Furnished"],availability:"Available",status:"Approved",owner:"Demo Owner",phone:"",description:"A shared-flat style listing with a balcony and common kitchen. This is an example listing for the prototype.",color:2,deposit:15000,gender:"Any"},
  {id:"p4",title:"Maple House — Student Hostel",type:"Hostel",rent:4800,city:"Pune",locality:"Viman Nagar",facilities:["Wi-Fi","Security","Meals"],availability:"Available",status:"Approved",owner:"Demo Owner",phone:"",description:"Budget-friendly sample hostel listing for exploring the search and filtering experience.",color:3,deposit:3000,gender:"Any"},
  {id:"p5",title:"Quiet Corner Private Room",type:"Single Room",rent:14500,city:"Pune",locality:"Aundh",facilities:["Attached bath","Furnished","Wi-Fi"],availability:"Available",status:"Approved",owner:"Demo Owner",phone:"",description:"A private-room sample listing with everyday amenities. Verify availability and terms with the property owner in a real service.",color:4,deposit:20000,gender:"Any"},
  {id:"p6",title:"The Shared House",type:"Shared Room",rent:5500,city:"Pune",locality:"Hinjawadi",facilities:["Wi-Fi","Laundry","Parking"],availability:"Available",status:"Approved",owner:"Demo Owner",phone:"",description:"A shared-room example near a work hub. Demo information only and not a verified accommodation offer.",color:5,deposit:5000,gender:"Any"}
];

const store = {
  read(key, fallback) { try { const value = localStorage.getItem("hh_" + key); return value ? JSON.parse(value) : fallback; } catch { return fallback; } },
  write(key, value) { localStorage.setItem("hh_" + key, JSON.stringify(value)); }
};
let properties = store.read("properties", initialProperties);
let favourites = store.read("favourites", []);
let enquiries = store.read("enquiries", []);
let currentUser = store.read("session", null);
let selectedType = "All";
let listView = false;
const $ = id => document.getElementById(id);
const money = value => "₹" + Number(value).toLocaleString("en-IN");
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),2800); }
function openDialog(id) { const el=$(id); if (el.showModal) el.showModal(); else el.setAttribute("open",""); }
function closeDialog(id) { const el=$(id); if (el.close) el.close(); else el.removeAttribute("open"); }
document.querySelectorAll("[data-close]").forEach(btn=>btn.addEventListener("click",()=>closeDialog(btn.dataset.close)));
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("click",e=>{if(e.target===d) d.close();}));
function sceneSvg(index) {
  const palettes = [
    ["#dce8dc","#6e8c72","#f1e6d1","#a8c8bd"],["#eee1d3","#9c765e","#f6f0e5","#adc6c0"],
    ["#dce7e9","#64847d","#f5ead5","#a8c9c2"],["#e8e1d5","#8d765f","#f5eddd","#c4cbb0"],
    ["#e2eadc","#708b71","#f5e9d4","#9fc2bb"],["#e9e1d7","#97735b","#f8efdf","#b6c9bf"]
  ];
  const [bg,roof,wall,win]=palettes[index%palettes.length];
  return `<svg viewBox="0 0 360 220" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustrative accommodation artwork"><rect width="360" height="220" fill="${bg}"/><circle cx="286" cy="45" r="27" fill="#f1d5a1"/><path d="M0 177 L70 137 L130 170 L205 126 L360 170 V220 H0Z" fill="#b8cbb5"/><path d="M68 97 L180 29 L292 97Z" fill="${roof}"/><rect x="91" y="92" width="178" height="111" rx="3" fill="${wall}"/><rect x="110" y="110" width="39" height="36" rx="2" fill="${win}" stroke="#fff7e9" stroke-width="5"/><rect x="160" y="110" width="39" height="36" rx="2" fill="${win}" stroke="#fff7e9" stroke-width="5"/><rect x="211" y="110" width="39" height="36" rx="2" fill="${win}" stroke="#fff7e9" stroke-width="5"/><rect x="157" y="159" width="46" height="44" rx="3" fill="#98755b"/><path d="M35 205 Q39 170 58 153 Q66 182 50 205Z" fill="#6c9274"/><path d="M324 205 Q300 171 311 150 Q338 173 332 205Z" fill="#648a70"/><rect y="204" width="360" height="16" fill="#a8bea5"/></svg>`;
}
function visibleProperties() {
  const query = $("locationInput").value.trim().toLowerCase();
  const budget = $("budgetSelect").value;
  let items = properties.filter(p=>p.status==="Approved" && p.availability==="Available");
  if(query) items=items.filter(p=>(p.city+" "+p.locality+" "+p.title).toLowerCase().includes(query) || query==="pune" && p.city.toLowerCase()==="pune");
  if(selectedType!=="All") items=items.filter(p=>p.type===selectedType);
  if(budget!=="all") items=items.filter(p=>Number(p.rent)<=Number(budget));
  const sort=$("sortSelect").value;
  if(sort==="low") items.sort((a,b)=>a.rent-b.rent);
  if(sort==="high") items.sort((a,b)=>b.rent-a.rent);
  return items;
}
function renderProperties() {
  const items=visibleProperties();
  $("resultsCount").textContent=`${items.length} ${items.length===1?"place":"places"} to explore`;
  $("propertyGrid").classList.toggle("list-view",listView);
  $("propertyGrid").innerHTML=items.map(p=>`
    <article class="property-card">
      <div class="property-image" data-open="${esc(p.id)}">${propertyVisual(p)}<span class="image-tag">${esc(p.type.toUpperCase())}</span><button class="fav-btn ${favourites.includes(p.id)?"saved":""}" data-fav="${esc(p.id)}" aria-label="Toggle favourite">${favourites.includes(p.id)?"♥":"♡"}</button></div>
      <div class="property-content">
        <div class="property-type-line"><span>${esc(p.type)} · Demo listing</span><span class="availability">${esc(p.availability)}</span></div>
        <h3 data-open="${esc(p.id)}">${esc(p.title)}</h3>
        <div class="property-location">⌖ ${esc(p.locality)}, ${esc(p.city)}</div>
        <div class="property-bottom"><div class="price"><strong>${money(p.rent)}</strong> <small>/ month</small></div><button class="details-link" data-open="${esc(p.id)}">View details ↗</button></div>
      </div>
    </article>`).join("");
  $("emptyState").classList.toggle("hidden",items.length>0);
}
function propertyVisual(p) {
  if (p.imageData) return `<img src="${esc(p.imageData)}" alt="${esc(p.title)}" style="width:100%;height:100%;object-fit:cover;display:block" />`;
  return sceneSvg(p.color||0);
}
function propertyById(id){return properties.find(p=>p.id===id);}
function openProperty(id) {
  const p=propertyById(id); if(!p) return;
  const safePhone=(p.phone||"").replace(/[^\d+]/g,"");
  $("propertyDetails").innerHTML=`
    <div class="modal-eyebrow">${esc(p.type.toUpperCase())} · DEMO LISTING</div>
    <div class="detail-hero">${propertyVisual(p)}</div>
    <div class="detail-head"><div><h2>${esc(p.title)}</h2><div class="detail-location">⌖ ${esc(p.locality)}, ${esc(p.city)}</div></div><div class="detail-price">${money(p.rent)}<small>per month</small></div></div>
    <p class="detail-description">${esc(p.description||"Demo property listing.")}</p>
    <div class="amenities">${(p.facilities||[]).map(x=>`<span>${esc(x)}</span>`).join("")}<span>Deposit: ${money(p.deposit||0)}</span><span>${esc(p.gender||"Any")} preference</span></div>
    <div class="demo-warning">Illustrative sample listing. Property details, photos, rent, and availability have not been independently verified.</div>
    <div class="detail-actions"><button class="btn btn-dark" id="enquireBtn">Send booking enquiry →</button><button class="btn btn-ghost" id="detailFav">${favourites.includes(p.id)?"♥ Saved":"♡ Save"}</button></div>
    <div class="detail-actions"><button class="btn btn-ghost" id="callBtn">☎ Call owner</button><button class="btn btn-ghost" id="waBtn">WhatsApp ↗</button></div>`;
  openDialog("propertyDialog");
  $("enquireBtn").onclick=()=>{closeDialog("propertyDialog");openEnquiry(id);};
  $("detailFav").onclick=()=>toggleFavourite(id);
  $("callBtn").onclick=()=>{if(!safePhone){toast("Demo listing has no real contact number.");return;}location.href="tel:"+safePhone;};
  $("waBtn").onclick=()=>{if(!safePhone){toast("Demo listing has no real WhatsApp number.");return;}window.open("https://wa.me/"+safePhone.replace(/\D/g,"")+"?text="+encodeURIComponent("Hi, I'm interested in "+p.title+". Is it available?"),"_blank","noopener");};
}
function toggleFavourite(id) {
  if(!currentUser){toast("Log in to save favourites (demo login).");openDialog("loginDialog");return;}
  if(favourites.includes(id)) favourites=favourites.filter(x=>x!==id); else favourites.push(id);
  store.write("favourites",favourites); renderProperties();
  if($("propertyDialog").open && propertyById(id)) openProperty(id);
  toast(favourites.includes(id)?"Added to favourites":"Removed from favourites");
}
function openEnquiry(id) {
  const p=propertyById(id); if(!p)return;
  if(!currentUser){toast("Log in first to submit an enquiry.");openDialog("loginDialog");return;}
  $("enquiryContent").innerHTML=`<div class="modal-eyebrow">YOUR NEXT STEP</div><h2 class="dashboard-title">Enquire about this <em>stay.</em></h2><p class="muted">${esc(p.title)} · ${money(p.rent)}/month · ${esc(p.locality)}</p><form class="stack-form" id="enquiryForm"><label>Preferred move-in date<input type="date" id="moveDate" required /></label><label>Message to owner<textarea id="enquiryMessage" rows="4" required placeholder="Hi, I'd like to know more about this room..."></textarea></label><button class="btn btn-dark full" type="submit">Send enquiry →</button></form><div class="demo-warning">This prototype stores enquiries only in this browser. No real owner is notified.</div>`;
  openDialog("enquiryDialog");
  $("moveDate").min=new Date().toISOString().slice(0,10);
  $("enquiryForm").onsubmit=e=>{
    e.preventDefault();
    enquiries.unshift({id:"e"+Date.now(),propertyId:id,propertyTitle:p.title,userName:currentUser.name,userRole:currentUser.role,date:$("moveDate").value,message:$("enquiryMessage").value,status:"Pending",ownerId:p.ownerId||null,createdAt:new Date().toISOString()});
    store.write("enquiries",enquiries);closeDialog("enquiryDialog");toast("Demo enquiry submitted successfully.");};
}
function updateHeader() {
  $("loginBtn").textContent=currentUser?currentUser.name.split(" ")[0]:"Log in";
  $("listPropertyBtn").textContent=currentUser&&currentUser.role==="Admin"?"Admin dashboard":currentUser&&currentUser.role==="Owner"?"Owner dashboard":"List your property ↗";
}
function openListing() {
  if(!currentUser){toast("Log in as a Property Owner to submit a listing.");openDialog("loginDialog");return;}
  if(currentUser.role==="Admin"){openDashboard();return;}
  if(currentUser.role!=="Owner"){toast("Switch to the Property Owner demo role to submit a listing.");openDialog("loginDialog");return;}
  openDialog("listingDialog");
}
function openDashboard() {
  if(!currentUser){openDialog("loginDialog");return;}
  if(currentUser.role==="User"){toast("Choose Owner or Admin demo role to open a dashboard.");openDialog("loginDialog");return;}
  const admin=currentUser.role==="Admin";
  const owned=properties.filter(p=>admin||p.ownerId===currentUser.id);
  const pending=admin?properties.filter(p=>p.status==="Pending"):owned.filter(p=>p.status==="Pending");
  const ownEnquiries=enquiries.filter(e=>admin || owned.some(p=>p.id===e.propertyId));
  $("dashboardContent").innerHTML=`
    <div class="modal-eyebrow">${admin?"ADMINISTRATION":"PROPERTY OWNER"}</div>
    <h2 class="dashboard-title">${admin?"Admin dashboard":"Your property dashboard"}</h2>
    <p class="dashboard-sub">${admin?"Review demo listings and manage enquiries.":"Manage your submitted demo listings and enquiries."}</p>
    <div class="stats-grid"><div class="stat-card"><small>${admin?"Total listings":"Your listings"}</small><strong>${owned.length}</strong></div><div class="stat-card"><small>Pending approval</small><strong>${pending.length}</strong></div><div class="stat-card"><small>Booking enquiries</small><strong>${ownEnquiries.length}</strong></div></div>
    ${admin?`<h3>Pending listing approvals</h3><div class="dashboard-list" id="approvalList">${pending.length?pending.map(p=>dashboardProperty(p,true)).join(""):'<div class="dashboard-empty">No pending listings.</div>'}</div>`:""}
    <h3 style="margin-top:22px">Property listings</h3><div class="dashboard-list">${owned.length?owned.map(p=>dashboardProperty(p,admin&&p.status==="Pending")).join(""):'<div class="dashboard-empty">No properties yet. Submit a listing to get started.</div>'}</div>
    <h3 style="margin-top:22px">Booking enquiries</h3><div class="dashboard-list">${ownEnquiries.length?ownEnquiries.map(e=>dashboardEnquiry(e,admin)).join(""):'<div class="dashboard-empty">No booking enquiries yet.</div>'}</div>
    <div class="demo-warning">Prototype note: this dashboard and its role selection are for demonstration only. Browser-stored roles are not secure; do not use for real users or sensitive data.</div>`;
  openDialog("dashboardDialog");
  $("dashboardContent").querySelectorAll("[data-approve]").forEach(b=>b.onclick=()=>moderateProperty(b.dataset.approve,"Approved"));
  $("dashboardContent").querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>moderateProperty(b.dataset.reject,"Rejected"));
  $("dashboardContent").querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>deleteProperty(b.dataset.delete));
  $("dashboardContent").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editProperty(b.dataset.edit));
  $("dashboardContent").querySelectorAll("[data-enquiry-status]").forEach(b=>b.onclick=()=>updateEnquiry(b.dataset.enquiryStatus,b.dataset.status));
}
function dashboardProperty(p,canModerate) {
  return `<div class="dashboard-item"><div class="mini-icon">⌂</div><div class="dashboard-item-info"><strong>${esc(p.title)}</strong><small>${esc(p.locality)}, ${esc(p.city)} · ${money(p.rent)}/month</small><small>Status: <span class="status-pill ${esc(p.status)}">${esc(p.status)}</span></small></div><div class="item-actions">${canModerate&&p.status==="Pending"?`<button class="mini-btn approve" data-approve="${esc(p.id)}">Approve</button><button class="mini-btn reject" data-reject="${esc(p.id)}">Reject</button>`:""}${currentUser.role==="Admin"||p.ownerId===currentUser.id?`${currentUser.role==="Owner"&&p.ownerId===currentUser.id?`<button class="mini-btn" data-edit="${esc(p.id)}">Edit</button>`:""}<button class="mini-btn" data-delete="${esc(p.id)}">Delete</button>`:""}</div></div>`;
}
function dashboardEnquiry(e,admin) {
  return `<div class="dashboard-item"><div class="mini-icon">✉</div><div class="dashboard-item-info"><strong>${esc(e.propertyTitle)}</strong><small>From ${esc(e.userName)} · Move-in: ${esc(e.date||"Not specified")}</small><small>${esc(e.message)}</small><small>Status: <span class="status-pill ${esc(e.status)}">${esc(e.status)}</span></small></div><div class="item-actions">${(admin||currentUser.role==="Owner")&&e.status==="Pending"?`<button class="mini-btn approve" data-enquiry-status="${esc(e.id)}" data-status="Accepted">Accept</button><button class="mini-btn reject" data-enquiry-status="${esc(e.id)}" data-status="Rejected">Reject</button>`:""}</div></div>`;
}
function moderateProperty(id,status) {
  if(!currentUser||currentUser.role!=="Admin"){toast("Only the demo Admin can moderate listings.");return;}
  properties=properties.map(p=>p.id===id?{...p,status}:p);store.write("properties",properties);renderProperties();openDashboard();toast("Listing marked "+status.toLowerCase()+".");
}
function editProperty(id) {
  const p=propertyById(id);
  if(!p || !currentUser || currentUser.role!=="Owner" || p.ownerId!==currentUser.id) {
    toast("You can only edit your own demo listings."); return;
  }
  closeDialog("dashboardDialog");
  $("pEditId").value=p.id;
  $("pTitle").value=p.title;
  $("pType").value=p.type;
  $("pRent").value=p.rent;
  $("pCity").value=p.city;
  $("pLocality").value=p.locality;
  $("pFacilities").value=(p.facilities||[]).join(", ");
  $("pPhone").value=p.phone||"";
  $("pDescription").value=p.description||"";
  $("pImage").value="";
  $("listingDialog").querySelector(".modal-eyebrow").textContent="UPDATE YOUR SPACE";
  $("listingDialog").querySelector("h2").innerHTML='Edit your <em>property.</em>';
  $("listingDialog").querySelector('button[type="submit"]').innerHTML='Save changes <span>→</span>';
  openDialog("listingDialog");
}
function resetListingForm() {
  $("listingForm").reset();
  $("pEditId").value="";
  $("pCity").value="Pune";
  $("listingDialog").querySelector(".modal-eyebrow").textContent="SHARE YOUR SPACE";
  $("listingDialog").querySelector("h2").innerHTML='List your <em>property.</em>';
  $("listingDialog").querySelector('button[type="submit"]').innerHTML='Submit for approval <span>→</span>';
}
function deleteProperty(id) {
  const p=propertyById(id);if(!p)return;
  if(currentUser.role!=="Admin"&&p.ownerId!==currentUser.id){toast("You cannot delete this listing.");return;}
  if(!confirm("Delete this demo listing?"))return;
  properties=properties.filter(x=>x.id!==id);store.write("properties",properties);renderProperties();openDashboard();toast("Demo listing deleted.");
}
function updateEnquiry(id,status) {
  enquiries=enquiries.map(e=>e.id===id?{...e,status}:e);store.write("enquiries",enquiries);openDashboard();toast("Enquiry status updated.");
}
$("propertyGrid").addEventListener("click",e=>{
  const fav=e.target.closest("[data-fav]");if(fav){e.stopPropagation();toggleFavourite(fav.dataset.fav);return;}
  const open=e.target.closest("[data-open]");if(open)openProperty(open.dataset.open);
});
$("typeFilters").addEventListener("click",e=>{const btn=e.target.closest("[data-type]");if(!btn)return;selectedType=btn.dataset.type;document.querySelectorAll(".chip").forEach(c=>c.classList.toggle("active",c===btn));renderProperties();});
$("searchBtn").onclick=renderProperties;
$("locationInput").addEventListener("keydown",e=>{if(e.key==="Enter")renderProperties();});
$("budgetSelect").onchange=renderProperties;$("sortSelect").onchange=renderProperties;
$("resetFilters").onclick=()=>{$("locationInput").value="";$("budgetSelect").value="all";selectedType="All";$("sortSelect").value="featured";document.querySelectorAll(".chip").forEach(c=>c.classList.toggle("active",c.dataset.type==="All"));renderProperties();};
$("gridViewBtn").onclick=()=>{listView=false;$("gridViewBtn").classList.add("active");$("listViewBtn").classList.remove("active");renderProperties();};
$("listViewBtn").onclick=()=>{listView=true;$("listViewBtn").classList.add("active");$("gridViewBtn").classList.remove("active");renderProperties();};
$("loginBtn").onclick=()=>{if(currentUser){if(currentUser.role==="Owner"||currentUser.role==="Admin")openDashboard();else openUserPanel();}else openDialog("loginDialog");};
$("loginForm").onsubmit=e=>{
  e.preventDefault();const name=$("loginName").value.trim();const role=$("loginRole").value;
  if(!name)return;
  currentUser={id:"demo-"+name.toLowerCase().replace(/[^a-z0-9]+/g,"-"),name,role};store.write("session",currentUser);closeDialog("loginDialog");updateHeader();toast(`Demo mode: signed in as ${role}.`);
  if(role==="Owner"||role==="Admin")openDashboard();else toast("Welcome! Browse stays and send a demo enquiry.");
};
$("listPropertyBtn").onclick=openListing;$("ctaListBtn").onclick=openListing;
$("listingForm").onsubmit=async e=>{
  e.preventDefault();
  if(!currentUser||currentUser.role!=="Owner"){toast("Please choose Property Owner demo role.");return;}
  const editId=$("pEditId").value;
  const existing=editId?propertyById(editId):null;
  if(editId && (!existing || existing.ownerId!==currentUser.id)){toast("You can only edit your own listing.");return;}
  const file=$("pImage").files && $("pImage").files[0];
  let imageData=existing?.imageData||"";
  if(file){
    if(!file.type.startsWith("image/")){toast("Please choose an image file.");return;}
    if(file.size>1024*1024){toast("Please choose an image under 1 MB.");return;}
    imageData=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||""));
      reader.onerror=()=>reject(new Error("Image could not be read."));
      reader.readAsDataURL(file);
    }).catch(()=>null);
    if(!imageData){toast("Could not read the image. Try another file.");return;}
  }
  const updated={
    ...(existing||{}),
    id:existing?existing.id:"p"+Date.now(),
    title:$("pTitle").value.trim(),
    type:$("pType").value,
    rent:Number($("pRent").value),
    city:$("pCity").value.trim(),
    locality:$("pLocality").value.trim(),
    facilities:$("pFacilities").value.split(",").map(x=>x.trim()).filter(Boolean),
    availability:"Available",
    status:"Pending",
    owner:currentUser.name,
    ownerId:currentUser.id,
    phone:$("pPhone").value.trim(),
    description:$("pDescription").value.trim()||"Owner-submitted demo listing awaiting review.",
    imageData,
    color:existing?.color ?? properties.length%6,
    deposit:existing?.deposit||0,
    gender:existing?.gender||"Any"
  };
  if(existing) properties=properties.map(p=>p.id===existing.id?updated:p);
  else properties.unshift(updated);
  store.write("properties",properties);
  closeDialog("listingDialog");
  resetListingForm();
  renderProperties();
  toast(existing?"Changes saved. Listing needs Admin re-approval.":"Listing submitted. It will appear publicly after Admin approval.");
  openDashboard();
};
function openUserPanel(){
  const mine=enquiries.filter(e=>e.userName===currentUser.name);
  $("dashboardContent").innerHTML=`<div class="modal-eyebrow">YOUR ACCOUNT</div><h2 class="dashboard-title">Hello, ${esc(currentUser.name)}.</h2><p class="dashboard-sub">Your demo favourites and booking enquiries.</p><h3>Saved favourites</h3><div class="dashboard-list">${favourites.length?favourites.map(id=>propertyById(id)).filter(Boolean).map(p=>dashboardProperty(p,false)).join(""):'<div class="dashboard-empty">No saved favourites yet. Tap the heart on a property card.</div>'}</div><h3 style="margin-top:22px">Your booking enquiries</h3><div class="dashboard-list">${mine.length?mine.map(e=>dashboardEnquiry(e,false)).join(""):'<div class="dashboard-empty">You have not sent any enquiries yet.</div>'}</div><button class="btn btn-ghost full" id="logoutBtn">Log out of demo</button><div class="demo-warning">This is a browser-only prototype. Account data is not securely authenticated or synced between devices.</div>`;
  openDialog("dashboardDialog");$("logoutBtn").onclick=()=>{currentUser=null;store.write("session",null);closeDialog("dashboardDialog");updateHeader();toast("Logged out of demo.");};
}
updateHeader();renderProperties();

$("listingDialog").addEventListener("close",()=>{ if(!$("listingDialog").open) resetListingForm(); });
