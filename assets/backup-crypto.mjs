const FORMAT='blood-note-encrypted-backup',ITERATIONS=600000,MAX_BYTES=3000000;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const aad=encoder.encode(FORMAT+':v1');
const base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
const unbase64=(text,max)=>{
  if(typeof text!=='string'||text.length>max*4/3+4||text.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw Error('백업 파일 형식이 올바르지 않습니다.');
  const bytes=Uint8Array.from(atob(text),c=>c.charCodeAt(0));if(bytes.length>max)throw Error('백업 파일이 너무 큽니다.');return bytes;
};
async function derive(password,salt,usage){
  if(typeof password!=='string'||password.length<10||password.length>1024)throw Error('백업 비밀번호는 10~1,024자로 입력해 주세요.');
  const bytes=encoder.encode(password);
  try{
    const material=await crypto.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveKey']);
    return await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS},material,{name:'AES-GCM',length:256},false,[usage]);
  }finally{bytes.fill(0);}
}
export const isEncryptedBackup=value=>value?.format===FORMAT;
export async function encryptBackup(text,password){
  const bytes=encoder.encode(text);if(bytes.length>MAX_BYTES)throw Error('백업 내용이 너무 큽니다.');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  try{
    const key=await derive(password,salt,'encrypt');
    const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,bytes);
    return JSON.stringify({format:FORMAT,version:1,kdf:'PBKDF2-HMAC-SHA256',iterations:ITERATIONS,cipher:'AES-256-GCM',salt:base64(salt),iv:base64(iv),data:base64(new Uint8Array(data))});
  }finally{bytes.fill(0);}
}
export async function decryptBackup(envelope,password){
  if(!isEncryptedBackup(envelope)||envelope.version!==1||envelope.kdf!=='PBKDF2-HMAC-SHA256'||envelope.iterations!==ITERATIONS||envelope.cipher!=='AES-256-GCM')throw Error('지원하지 않는 암호화 백업입니다.');
  const salt=unbase64(envelope.salt,16),iv=unbase64(envelope.iv,12),data=unbase64(envelope.data,MAX_BYTES+16);
  if(salt.length!==16||iv.length!==12||data.length<16)throw Error('백업 파일 형식이 올바르지 않습니다.');
  const key=await derive(password,salt,'decrypt');
  let bytes;
  try{
    bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,data));
    return decoder.decode(bytes);
  }catch{throw Error('비밀번호가 맞지 않거나 백업 파일이 손상되었습니다.');}
  finally{bytes?.fill(0);}
}
