import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createCipheriv,createDecipheriv,pbkdf2Sync} from 'node:crypto';
import {createProtectedStorage} from '../assets/secure-storage.mjs';
import {encryptBackup,decryptBackup} from '../assets/backup-crypto.mjs';
import {migrateLegacyTypes,DEFAULT_RULES,clone} from '../assets/engine.mjs';

const RECORDS='blood-note-v1',HOLIDAYS='blood-note-holidays-v1';
function nativeFixture(initial){
  const key=randomBytes(32),legacy=new Map(Object.entries(initial||{}));
  let disk=null,writeCount=0,cleared=0,failWrite=false,failRead=false;
  const bridge={
    readSecureData(){
      if(failRead)return '{"ok":false}';
      if(!disk)return '{"ok":true,"data":null}';
      try{const decipher=createDecipheriv('aes-256-gcm',key,disk.subarray(0,12));decipher.setAuthTag(disk.subarray(-16));
        return JSON.stringify({ok:true,data:Buffer.concat([decipher.update(disk.subarray(12,-16)),decipher.final()]).toString()});
      }catch{return '{"ok":false}';}
    },
    writeSecureData(text){
      if(failWrite)return '{"ok":false}';
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
      disk=Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]);writeCount++;
      return '{"ok":true}';
    },clearLegacyStorage(){cleared++;}
  };
  const legacyStorage={getItem:k=>legacy.get(k)??null,setItem:(k,v)=>legacy.set(k,v),removeItem:k=>legacy.delete(k)};
  return {bridge,legacyStorage,legacy,disk:()=>disk,writes:()=>writeCount,cleared:()=>cleared,
    failWrite:value=>failWrite=value,failRead:value=>failRead=value,corrupt:()=>disk[20]^=1};
}
const records=JSON.stringify({version:1,records:[{id:'PRIVATE-RECORD-CANARY',date:'2026-10-08',type:'mixed'}],plans:[{id:'future',date:'2026-11-20',type:'whole'}]});

test('Verified encrypted migration preserves history, plans and holiday cache; restart never recreates plaintext',()=>{
  const h=nativeFixture({[RECORDS]:records,[HOLIDAYS]:'{"private-cache":true}'});
  const store=createProtectedStorage(h);
  assert.equal(store.getItem(RECORDS),records);assert.equal(store.getItem(HOLIDAYS),'{"private-cache":true}');
  assert.equal(h.legacy.size,0);assert.equal(h.cleared(),1);assert.equal(h.writes(),1);
  assert.ok(!h.disk().includes(Buffer.from('PRIVATE-RECORD-CANARY')));
  store.setItem(RECORDS,records);assert.equal(h.writes(),1);
  store.setItem(RECORDS,records+' ');assert.equal(h.writes(),2);assert.equal(h.legacy.size,0);
  const restarted=createProtectedStorage(h);assert.equal(restarted.getItem(RECORDS),records+' ');
  assert.equal(h.writes(),2);
});

test('Failed writes/read-back never erase old plaintext; corrupt encrypted storage never falls back or overwrites',()=>{
  const h=nativeFixture({[RECORDS]:records});h.failWrite(true);
  assert.throws(()=>createProtectedStorage(h));assert.equal(h.legacy.get(RECORDS),records);assert.equal(h.cleared(),0);
  h.failWrite(false);
  const realRead=h.bridge.readSecureData;let reads=0;
  h.bridge.readSecureData=()=>++reads===2?'{"ok":false}':realRead();
  assert.throws(()=>createProtectedStorage(h));assert.equal(h.legacy.get(RECORDS),records);assert.equal(h.cleared(),0);
  h.bridge.readSecureData=realRead;
  const recovered=createProtectedStorage(h);assert.equal(recovered.getItem(RECORDS),records);assert.equal(h.legacy.size,0);
  h.legacy.set(RECORDS,'stale plaintext');h.corrupt();const damaged=Buffer.from(h.disk());
  assert.throws(()=>createProtectedStorage(h));assert.deepEqual(h.disk(),damaged);assert.equal(h.legacy.get(RECORDS),'stale plaintext');
});

test('Unavailable key, invalid legacy records and storage failures fail closed without partial state changes',()=>{
  const h=nativeFixture({[RECORDS]:records});h.failRead(true);
  assert.throws(()=>createProtectedStorage(h));assert.equal(h.legacy.get(RECORDS),records);assert.equal(h.writes(),0);
  h.failRead(false);
  assert.throws(()=>createProtectedStorage({...h,validateRecords:()=>{throw Error('bad records');}}));
  assert.equal(h.legacy.get(RECORDS),records);assert.equal(h.writes(),0);
  const store=createProtectedStorage(h),saved=Buffer.from(h.disk());h.failWrite(true);
  assert.throws(()=>store.setItem(RECORDS,'replacement'));assert.equal(store.getItem(RECORDS),records);assert.deepEqual(h.disk(),saved);
  assert.throws(()=>createProtectedStorage({bridge:{},legacyStorage:h.legacyStorage}));
});

test('Old three-type backups gain platelet settings without guessing the original type of mixed records',()=>{
  const old={rules:clone(DEFAULT_RULES),records:JSON.parse(records).records,plans:JSON.parse(records).plans};
  delete old.rules.volumes.platelet;delete old.rules.waits.platelet;
  const updated=migrateLegacyTypes(old);
  assert.equal(updated.rules.volumes.platelet,90);assert.equal(updated.rules.waits.platelet,14);
  assert.deepEqual(updated.records,old.records);assert.deepEqual(updated.plans,old.plans);
  assert.equal(updated.records[0].type,'mixed');
});

test('Portable backup encrypts all records with fresh salt/IV and matches an independent AES-GCM decryptor',async()=>{
  const password='오프라인-백업-비밀번호-123';
  const first=JSON.parse(await encryptBackup(records,password)),second=JSON.parse(await encryptBackup(records,password));
  assert.notEqual(first.salt,second.salt);assert.notEqual(first.iv,second.iv);assert.notEqual(first.data,second.data);
  assert.ok(!JSON.stringify(first).includes('PRIVATE-RECORD-CANARY'));
  assert.equal(await decryptBackup(first,password),records);
  const key=pbkdf2Sync(password,Buffer.from(first.salt,'base64'),600000,32,'sha256');
  const data=Buffer.from(first.data,'base64'),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(first.iv,'base64'));
  decipher.setAAD(Buffer.from('blood-note-encrypted-backup:v1'));decipher.setAuthTag(data.subarray(-16));
  assert.equal(Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]).toString(),records);
});

test('Wrong passwords, tampering and excessive KDF parameters cannot decrypt a backup',async()=>{
  const password='correct-password-123',encrypted=JSON.parse(await encryptBackup(records,password));
  await assert.rejects(()=>decryptBackup(encrypted,'incorrect-password-123'),/비밀번호/);
  const altered={...encrypted,data:(encrypted.data[0]==='A'?'B':'A')+encrypted.data.slice(1)};
  await assert.rejects(()=>decryptBackup(altered,password),/비밀번호/);
  await assert.rejects(()=>decryptBackup({...encrypted,iterations:2147483647},password),/지원하지/);
  await assert.rejects(()=>decryptBackup({...encrypted,iv:'AA=='},password),/형식/);
  await assert.rejects(()=>encryptBackup(records,'short'),/10/);
});
