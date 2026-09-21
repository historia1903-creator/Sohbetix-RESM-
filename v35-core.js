(() => {
  'use strict';

  const USER_KEY='sohbetix-local-users-v30';
  const USER_MIGRATIONS=['sohbetix-local-users-v28','sohbetix-local-users-v27','sohbetix-local-users-v25','sohbetix-local-users-v24'];
  const PROFILE_PREFIX='sohbetix-v30-chat-profiles:';
  const OLD_PROFILE_PREFIXES=['sohbetix-v28-chat-profiles:','sohbetix-v27-chat-profiles:','sohbetix-v26-chat-profiles:','sohbetix-v25-chat-profiles:'];
  const PROFILE_DATA_PREFIX='sohbetix-v30-profile-data:';
  const OLD_PROFILE_DATA_PREFIXES=['sohbetix-v28-profile-data:','sohbetix-v27-profile-data:'];
  const IGNORE_PREFIX='sohbetix-v30-ignore:';
  const OLD_IGNORE_PREFIXES=['sohbetix-v28-ignore:','sohbetix-v27-ignore:'];
  const DELETED_NICKS_KEY='sohbetix-v30-deleted-nicks';
  const PRESENCE_PREFIX='sohbetix-v30-room-presence:';
  const PRESENCE_TTL=240000;
  const COIN_GRANT_KEY='sohbetix-v30-5000-grant-done';
  const DAY=86400000;
  const MONTH_30=30*DAY;

  const safe=(raw,fallback)=>{try{return raw?JSON.parse(raw):fallback}catch{return fallback}};
  const norm=v=>String(v||'').trim().toLocaleLowerCase('tr-TR');
  const cleanNick=v=>String(v||'').replace(/[\r\n\t]/g,' ').replace(/\s{2,}/g,' ').trim().slice(0,20);
  const uuid=()=>crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function migrateUsers(){
    if(!localStorage.getItem(USER_KEY)){
      const old=USER_MIGRATIONS.find(k=>localStorage.getItem(k));
      if(old) localStorage.setItem(USER_KEY,localStorage.getItem(old));
      else localStorage.setItem(USER_KEY,'[]');
    }
    const firstGrant=localStorage.getItem(COIN_GRANT_KEY)!=='1';
    const list=users().map(u=>({
      ...u,
      id:u.id||uuid(),
      coins:(Number.isFinite(Number(u.coins))?Number(u.coins):150),
      vipUntil:Number(u.vipUntil||0),
      createdAt:Number(u.createdAt||Date.now()),
      emailVerified:u.emailVerified===false?false:true,
      emailVerifiedAt:Number(u.emailVerifiedAt||u.createdAt||Date.now())
    }));
    saveUsers(list);
    if(firstGrant) localStorage.setItem(COIN_GRANT_KEY,'1');
  }

  function users(){const x=safe(localStorage.getItem(USER_KEY),[]);return Array.isArray(x)?x:[]}
  function saveUsers(list){localStorage.setItem(USER_KEY,JSON.stringify(Array.isArray(list)?list:[]));}
  function currentUserId(){return String(localStorage.getItem('sohbetix-auth-id')||'');}
  function currentUser(){const id=currentUserId();return users().find(u=>String(u.id)===id)||null;}
  function updateUser(id,patch){
    const list=users(); const idx=list.findIndex(u=>String(u.id)===String(id));
    if(idx<0)return null; list[idx]={...list[idx],...patch}; saveUsers(list); return list[idx];
  }
  function ensureCurrentUser(){
    const id=currentUserId(); if(!id)return null;
    let user=currentUser();
    if(user && !Number.isFinite(Number(user.coins))) user=updateUser(id,{coins:150});
    user=refreshVipExpiration(user);
    return user;
  }
  function coinBalance(){return Number(ensureCurrentUser()?.coins||0);}
  function isVipUser(user){return !!user && Number(user.vipUntil||0)>Date.now();}
  function isVipCurrent(){return isVipUser(ensureCurrentUser());}
  function buyVip(kind){
    const user=ensureCurrentUser(); if(!user)return {ok:false,error:'Önce hesabına giriş yap.'};
    const yearly=kind==='year';
    const cost=yearly?1200:150;
    const duration=yearly?365*DAY:30*DAY;
    if(Number(user.coins||0)<cost)return {ok:false,error:'Yeterli jetonun yok.',need:cost,balance:Number(user.coins||0)};
    const base=Math.max(Date.now(),Number(user.vipUntil||0));
    const next=updateUser(user.id,{coins:Number(user.coins)-cost,vipUntil:base+duration});
    return {ok:true,user:next,cost,until:next.vipUntil};
  }

  function clearExpiredVipFeatures(user){
    if(!user)return;
    const ownerId=String(user.id||'');
    if(!ownerId)return;
    const profiles=readProfiles(ownerId);
    for(const profile of profiles){
      const data=getProfileDataByProfile(profile);
      let changed=false;
      if(data.boldNick){data.boldNick=false;changed=true;}
      if(data.boldText){data.boldText=false;changed=true;}
      if(/^data:image\/gif/i.test(String(data.photo||''))){data.photo='';changed=true;}
      if(changed) saveProfileData(profile.id,data);
    }
  }
  function refreshVipExpiration(user){
    if(!user)return user;
    const until=Number(user.vipUntil||0);
    if(until>0 && until<=Date.now()){
      const next=updateUser(user.id,{vipUntil:0});
      clearExpiredVipFeatures(next||user);
      return next||{...user,vipUntil:0};
    }
    return user;
  }

  function profilesKey(ownerId){return PROFILE_PREFIX+String(ownerId||'guest');}
  function migrateProfiles(ownerId){
    if(!ownerId)return;
    const key=profilesKey(ownerId);
    if(localStorage.getItem(key))return;
    for(const prefix of OLD_PROFILE_PREFIXES){
      const old=localStorage.getItem(prefix+ownerId);
      if(old){
        const arr=safe(old,[]);
        const migrated=Array.isArray(arr)?arr.map(p=>({...p,id:p.id||uuid(),ownerId:String(ownerId),nick:cleanNick(p.nick)})).filter(p=>p.nick):[];
        localStorage.setItem(key,JSON.stringify(migrated));
        return;
      }
    }
    localStorage.setItem(key,'[]');
  }
  function readProfiles(ownerId=currentUserId()){
    if(!ownerId)return[]; migrateProfiles(ownerId);
    const x=safe(localStorage.getItem(profilesKey(ownerId)),[]);
    return Array.isArray(x)?x.map(p=>({...p,ownerId:String(ownerId),nick:cleanNick(p.nick)})).filter(p=>p.nick):[];
  }
  function writeProfiles(ownerId,list){localStorage.setItem(profilesKey(ownerId),JSON.stringify((list||[]).slice(0,10)));}
  function allProfiles(){
    const out=[];
    for(const u of users()) migrateProfiles(u.id);
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i); if(!key||!key.startsWith(PROFILE_PREFIX))continue;
      const ownerId=key.slice(PROFILE_PREFIX.length);
      const arr=safe(localStorage.getItem(key),[]);
      if(Array.isArray(arr)) arr.forEach(p=>{if(p&&cleanNick(p.nick))out.push({...p,ownerId,nick:cleanNick(p.nick)});});
    }
    const seen=new Set();
    return out.filter(p=>{const k=norm(p.nick);if(!k||seen.has(k))return false;seen.add(k);return true;});
  }

  function profileDataKey(profileId){return PROFILE_DATA_PREFIX+String(profileId);}
  function defaultProfileData(){return {gender:'unknown',birthDay:'',birthMonth:'',birthYear:'',country:'',marital:'',about:'',nickColor:'#006600',textColor:'#333333',boldNick:false,boldText:false,privateEnabled:true,photo:'',updatedAt:0,lastNickChangedAt:0};}
  function getProfileByNick(nick){return allProfiles().find(p=>norm(p.nick)===norm(nick))||null;}
  function getProfileDataByProfile(profile){
    if(!profile)return defaultProfileData();
    const key=profileDataKey(profile.id);
    if(!localStorage.getItem(key)){
      for(const prefix of OLD_PROFILE_DATA_PREFIXES){const old=localStorage.getItem(prefix+String(profile.id));if(old){localStorage.setItem(key,old);break;}}
    }
    const data=safe(localStorage.getItem(key),{});
    return {...defaultProfileData(),...data};
  }
  function getProfileData(nick){return getProfileDataByProfile(getProfileByNick(nick));}
  function saveProfileData(profileId,data){
    const next={...defaultProfileData(),...data,updatedAt:Date.now()};
    localStorage.setItem(profileDataKey(profileId),JSON.stringify(next)); return next;
  }
  function profileOwnerUser(profile){return profile?users().find(u=>String(u.id)===String(profile.ownerId))||null:null;}
  function profileContext(nick){
    const profile=getProfileByNick(nick); const user=profileOwnerUser(profile); const data=getProfileDataByProfile(profile);
    return {profile,user,data,vip:isVipUser(user)};
  }

  function deletedNicks(){if(!localStorage.getItem(DELETED_NICKS_KEY)){const old=localStorage.getItem('sohbetix-v28-deleted-nicks');if(old)localStorage.setItem(DELETED_NICKS_KEY,old);}const x=safe(localStorage.getItem(DELETED_NICKS_KEY),[]);return Array.isArray(x)?x:[]}
  function reserveDeletedNick(nick){const list=deletedNicks();const n=cleanNick(nick);if(n&&!list.some(x=>norm(x)===norm(n)))list.push(n);localStorage.setItem(DELETED_NICKS_KEY,JSON.stringify(list));}
  function nickAvailable(nick,excludeProfileId=''){
    const n=cleanNick(nick); if(!n)return false;
    if(deletedNicks().some(x=>norm(x)===norm(n)))return false;
    return !allProfiles().some(p=>String(p.id)!==String(excludeProfileId)&&norm(p.nick)===norm(n));
  }

  function ignoreKey(ownerId=currentUserId()){return IGNORE_PREFIX+String(ownerId||'guest');}
  function ignored(ownerId=currentUserId()){
    const id=String(ownerId||'guest'), key=ignoreKey(id);
    if(!localStorage.getItem(key)){
      for(const prefix of OLD_IGNORE_PREFIXES){const old=localStorage.getItem(prefix+id);if(old){localStorage.setItem(key,old);break;}}
    }
    const x=safe(localStorage.getItem(key),[]);return Array.isArray(x)?x:[]
  }
  function ignoreNick(nick){const id=currentUserId();if(!id)return false;const list=ignored(id);const n=cleanNick(nick);const self=cleanNick(sessionStorage.getItem('sohbetix-v17-current-nick')||'');if(!n||norm(n)===norm(self))return false;if(!list.some(x=>norm(x)===norm(n)))list.push(n);localStorage.setItem(ignoreKey(id),JSON.stringify(list));return true;}
  function unignoreNick(nick){const id=currentUserId();if(!id)return;localStorage.setItem(ignoreKey(id),JSON.stringify(ignored(id).filter(x=>norm(x)!==norm(nick))));}
  function isIgnored(nick){return ignored().some(x=>norm(x)===norm(nick));}
  function ownerIdForNick(nick){return String(getProfileByNick(nick)?.ownerId||'');}
  function ignoredBy(ownerId,nick){return !!ownerId && ignored(ownerId).some(x=>norm(x)===norm(nick));}
  function isBlockedBetween(nickA,nickB){
    const a=cleanNick(nickA), b=cleanNick(nickB); if(!a||!b)return false;
    const ownerA=ownerIdForNick(a), ownerB=ownerIdForNick(b);
    return (ownerA && ignoredBy(ownerA,b)) || (ownerB && ignoredBy(ownerB,a));
  }

  function presenceItemActive(item, now=Date.now()){
    if(!item)return false;
    const last=Number(item.lastSeen||0), closing=Number(item.closingAt||0);
    if(closing>0) return now-closing<8000;
    // Mobil tarayıcı arka plana atıldığında JS zamanlayıcıları durabilir.
    // Sekme açık ama askıdaysa sahte 'bizi terk ediyor' üretme.
    if(item.suspended) return now-last<=12*60*60*1000;
    return now-last<=PRESENCE_TTL;
  }

  function allPresence(){
    const rows=[]; const now=Date.now();
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(!key||!key.startsWith(PRESENCE_PREFIX))continue;
      const slug=key.slice(PRESENCE_PREFIX.length);const data=safe(localStorage.getItem(key),{});
      for(const [clientId,item] of Object.entries(data||{})){
        if(presenceItemActive(item,now)) rows.push({...item,clientId,slug});
      }
    }
    const map=new Map();
    rows.forEach(r=>{const k=norm(r.nick);if(!k)return;const prev=map.get(k);if(!prev||Number(r.lastSeen)>Number(prev.lastSeen))map.set(k,r);});
    return [...map.values()];
  }
  function isNickOnline(nick){return allPresence().some(x=>norm(x.nick)===norm(nick));}
  function removeNickFromAllPresence(nick){
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(!key||!key.startsWith(PRESENCE_PREFIX))continue;
      const data=safe(localStorage.getItem(key),{});let changed=false;
      for(const [id,item] of Object.entries(data||{})){if(item&&norm(item.nick)===norm(nick)){delete data[id];changed=true;}}
      if(changed)localStorage.setItem(key,JSON.stringify(data));
    }
  }

  function ageFromBirth(data){
    const y=Number(data?.birthYear),m=Number(data?.birthMonth),d=Number(data?.birthDay); if(!y||!m||!d)return null;
    const now=new Date();let age=now.getFullYear()-y;const md=(now.getMonth()+1)-m;if(md<0||(md===0&&now.getDate()<d))age--;return age>=0?age:null;
  }

  // ===== V34: sohbet sahibi hesabı + kontrol paneli üyeliği =====
  const CONTROL_USERS_KEY='sohbetix-control-users-v21';
  const CONTROL_SESSION_KEY='sohbetix-control-session-v21';
  const CHAT_PLAN_PREFIX='sohbetix-v34-chat-plan:';
  const CONTROL_COIN_GRANT_PREFIX='sohbetix-v34-control-coin-grant:';

  function readControlUsers(){const x=safe(localStorage.getItem(CONTROL_USERS_KEY),[]);return Array.isArray(x)?x:[];}
  function writeControlUsers(list){localStorage.setItem(CONTROL_USERS_KEY,JSON.stringify(Array.isArray(list)?list:[]));}
  function controlSession(){return safe(localStorage.getItem(CONTROL_SESSION_KEY),null);}
  function controlUser(){const ses=controlSession();if(!ses?.id)return null;return readControlUsers().find(u=>String(u.id)===String(ses.id))||{...ses};}
  function updateControlUser(id,patch){const list=readControlUsers();const i=list.findIndex(u=>String(u.id)===String(id));if(i<0)return null;list[i]={...list[i],...patch};writeControlUsers(list);const ses=controlSession();if(ses&&String(ses.id)===String(id))localStorage.setItem(CONTROL_SESSION_KEY,JSON.stringify({...ses,...patch,id:list[i].id,email:list[i].email}));return list[i];}
  function ensureControlCoins(){let u=controlUser();if(!u)return null;const k=CONTROL_COIN_GRANT_PREFIX+u.id;if(!Number.isFinite(Number(u.coins))){u=updateControlUser(u.id,{coins:150})||{...u,coins:150};localStorage.setItem(k,'1');}return u;}
  function platformAccount(){
    const cu=ensureControlCoins();
    if(cu)return {kind:'control',user:cu};
    const u=ensureCurrentUser();
    return u?{kind:'chat',user:u}:null;
  }
  function platformAccountKey(){const a=platformAccount();return a?`${a.kind}:${a.user.id}`:'';}
  function platformIdentity(){
    const a=platformAccount();if(!a)return 'Giriş yap';const u=a.user||{};
    return String(u.displayName||u.name||u.googleName||u.fullName||localStorage.getItem('sohbetix-google-name')||u.email||'Sohbetix Kullanıcısı');
  }
  function platformEmail(){return String(platformAccount()?.user?.email||'');}
  function platformCoinBalance(){const a=platformAccount();return Number(a?.user?.coins||0);}
  function updatePlatformUser(patch){const a=platformAccount();if(!a)return null;return a.kind==='control'?updateControlUser(a.user.id,patch):updateUser(a.user.id,patch);}
  function stableAccountNumber(){const key=platformAccountKey();if(!key)return '—';let h=2166136261;for(const ch of key){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return String(1000000+(Math.abs(h>>>0)%9000000));}
  function chatPlanKey(){const key=platformAccountKey();return key?CHAT_PLAN_PREFIX+key:'';}
  function readChatPlan(){const k=chatPlanKey();if(!k)return null;const p=safe(localStorage.getItem(k),null);if(!p)return null;if(Number(p.expiresAt||0)<=Date.now())return {...p,active:false};return {...p,active:true};}
  function hasActiveChatPlan(){return !!readChatPlan()?.active;}
  function buyChatPlan(kind){
    const a=platformAccount();if(!a)return {ok:false,error:'Önce hesabına giriş yap.'};
    const yearly=kind==='year';const cost=yearly?1600:300;const duration=yearly?365*DAY:30*DAY;
    const balance=platformCoinBalance();if(balance<cost)return {ok:false,error:'Yeterli jetonun yok.',need:cost,balance};
    updatePlatformUser({coins:balance-cost});
    const now=Date.now(), existing=readChatPlan(), base=existing?.active?Math.max(now,Number(existing.expiresAt||0)):now;
    const plan={kind:yearly?'year':'month',cost,startedAt:now,expiresAt:base+duration,active:true};
    localStorage.setItem(chatPlanKey(),JSON.stringify(plan));
    return {ok:true,plan,balance:balance-cost};
  }
  function platformLogout(){
    localStorage.removeItem(CONTROL_SESSION_KEY);
    ['sohbetix-auth-type','sohbetix-auth-nick','sohbetix-auth-email','sohbetix-auth-id'].forEach(k=>localStorage.removeItem(k));
    ['sohbetix-v17-current-nick','sohbetix-v30-open-profile'].forEach(k=>sessionStorage.removeItem(k));
  }

  migrateUsers();
  users().forEach(u=>migrateProfiles(u.id));
  users().forEach(u=>refreshVipExpiration(u));

  window.SohbetixV34={
    USER_KEY,PROFILE_PREFIX,PROFILE_DATA_PREFIX,PRESENCE_PREFIX,PRESENCE_TTL,MONTH_30,COIN_GRANT_KEY,
    safe,norm,cleanNick,uuid,users,saveUsers,currentUserId,currentUser,updateUser,ensureCurrentUser,coinBalance,isVipUser,isVipCurrent,buyVip,refreshVipExpiration,clearExpiredVipFeatures,
    profilesKey,readProfiles,writeProfiles,allProfiles,getProfileByNick,profileDataKey,defaultProfileData,getProfileDataByProfile,getProfileData,saveProfileData,profileOwnerUser,profileContext,
    deletedNicks,reserveDeletedNick,nickAvailable,ignored,ignoreNick,unignoreNick,isIgnored,ownerIdForNick,ignoredBy,isBlockedBetween,presenceItemActive,allPresence,isNickOnline,removeNickFromAllPresence,ageFromBirth,
    CONTROL_USERS_KEY,CONTROL_SESSION_KEY,readControlUsers,writeControlUsers,controlSession,controlUser,updateControlUser,platformAccount,platformAccountKey,platformIdentity,platformEmail,platformCoinBalance,updatePlatformUser,stableAccountNumber,readChatPlan,hasActiveChatPlan,buyChatPlan,platformLogout
  };
})();


// ===== Sohbetix V35: oda/rol/admin statik katmanı =====
(() => {
  'use strict';
  const B=window.SohbetixV34;
  if(!B) return;
  const ADMIN_EMAIL='historia1903@gmail.com';
  const ROOM_PREFIX='sohbetix-v35-rooms:';
  const ROLE_PREFIX='sohbetix-v35-roles:';
  const CHAT_BAN_PREFIX='sohbetix-v35-chat-bans:';
  const cfg=()=>{try{return JSON.parse(localStorage.getItem('sohbetix-v18-chat-config')||'{}')}catch{return {}}};
  const chatSlug=()=>String(cfg().slug||'sohbetix').trim().toLowerCase()||'sohbetix';
  const roomKey=()=>ROOM_PREFIX+chatSlug();
  const roleKey=()=>ROLE_PREFIX+chatSlug();
  const banKey=()=>CHAT_BAN_PREFIX+chatSlug();
  const defaultRoom=()=>({id:'main',title:'Ana sayfa',visible:true,joinLeave:true,hidden:false,allowClose:false,welcomeEnabled:false,welcome:'',minAge:0,readAccess:'all',enterAccess:'entered',sendAccess:'entered',linkAccess:'entered',maxLength:512,badWords:false,createdAt:Date.now()});
  function readRooms(){let x;try{x=JSON.parse(localStorage.getItem(roomKey())||'[]')}catch{x=[]}if(!Array.isArray(x)||!x.length)x=[defaultRoom()];if(!x.some(r=>r.id==='main'))x.unshift(defaultRoom());return x.slice(0,3).map((r,i)=>({...defaultRoom(),...r,id:i===0?'main':String(r.id||B.uuid()),title:String(r.title|| (i===0?'Ana sayfa':'Yeni sekme')).slice(0,32)}));}
  function writeRooms(list){const safe=(Array.isArray(list)?list:[]).slice(0,3);if(!safe.some(r=>r.id==='main'))safe.unshift(defaultRoom());localStorage.setItem(roomKey(),JSON.stringify(safe.slice(0,3)));return safe;}
  function roomById(id='main'){return readRooms().find(r=>String(r.id)===String(id))||readRooms()[0];}
  function roleMap(){try{const x=JSON.parse(localStorage.getItem(roleKey())||'{}');return x&&typeof x==='object'?x:{}}catch{return {}}}
  function roleForNick(nick){return roleMap()[B.norm(nick)]||'user';}
  function setRoleForNick(nick,role){const m=roleMap();const k=B.norm(nick);if(!k)return;role=['admin','moderator','user'].includes(role)?role:'user';if(role==='user')delete m[k];else m[k]=role;localStorage.setItem(roleKey(),JSON.stringify(m));window.dispatchEvent(new StorageEvent('storage',{key:roleKey(),newValue:JSON.stringify(m)}));}
  function bannedNicks(){try{const x=JSON.parse(localStorage.getItem(banKey())||'[]');return Array.isArray(x)?x:[]}catch{return []}}
  function banNick(nick){const n=B.cleanNick(nick);if(!n)return;const a=bannedNicks();if(!a.some(x=>B.norm(x)===B.norm(n)))a.push(n);localStorage.setItem(banKey(),JSON.stringify(a));B.reserveDeletedNick(n);B.removeNickFromAllPresence(n);}
  function isChatBanned(nick){return bannedNicks().some(x=>B.norm(x)===B.norm(nick));}
  function isSiteAdmin(){return B.norm(B.platformEmail())===B.norm(ADMIN_EMAIL);}
  function containsBlockedTerms(text){const s=B.norm(text).replace(/[._*\-]+/g,' ');const words=['amk','aq','orospu','sik','siker','siktir','yarrak','piç','pic','porno','porn','sex','seks','xxx','nude','çıplak','ciplak'];return words.some(w=>s.includes(w));}
  function deleteProfile(profileId,{ban=true}={}){const p=B.allProfiles().find(x=>String(x.id)===String(profileId));if(!p)return false;const list=B.readProfiles(p.ownerId).filter(x=>String(x.id)!==String(profileId));B.writeProfiles(p.ownerId,list);localStorage.removeItem(B.profileDataKey(profileId));if(ban)banNick(p.nick);return true;}
  const ext={ADMIN_EMAIL,chatSlug,readRooms,writeRooms,roomById,roleMap,roleForNick,setRoleForNick,bannedNicks,banNick,isChatBanned,isSiteAdmin,containsBlockedTerms,deleteProfile};
  Object.assign(B,ext);
  window.SohbetixV35={...B,...ext};
})();
