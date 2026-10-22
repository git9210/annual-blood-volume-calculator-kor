const KEYS=['blood-note-v1','blood-note-holidays-v1'];
const checkReply=value=>{const reply=JSON.parse(value);if(reply?.ok!==true)throw Error('암호화 저장소를 열거나 저장하지 못했습니다.');return reply;};
const unpack=text=>{
  const data=JSON.parse(text);
  if(data?.version!==1||!data.values||typeof data.values!=='object'||Array.isArray(data.values)||
    Object.keys(data.values).some(key=>!KEYS.includes(key)||typeof data.values[key]!=='string'))throw Error('암호화 저장 내용이 올바르지 않습니다.');
  return data.values;
};
export function createProtectedStorage({bridge,legacyStorage,validateRecords=()=>{}}){
  if(!bridge?.readSecureData||!bridge?.writeSecureData)throw Error('암호화 저장 기능을 사용할 수 없습니다.');
  const loaded=checkReply(bridge.readSecureData());
  let values=loaded.data===null?{}:unpack(loaded.data);
  const save=next=>checkReply(bridge.writeSecureData(JSON.stringify({version:1,values:next})));
  if(loaded.data===null){
    // Do not delete old data unless encrypted writing AND read-back have both succeeded.
    for(const key of KEYS){const value=legacyStorage.getItem(key);if(value!==null)values[key]=value;}
    if(values['blood-note-v1'])validateRecords(values['blood-note-v1']);
    if(Object.keys(values).length){
      save(values);
      const verified=unpack(checkReply(bridge.readSecureData()).data);
      if(JSON.stringify(verified)!==JSON.stringify(values))throw Error('기존 기록의 암호화 이전을 확인하지 못했습니다.');
    }
  }else if(values['blood-note-v1'])validateRecords(values['blood-note-v1']);
  // A restart after interrupted cleanup always prefers the verified encrypted copy.
  if(loaded.data!==null||Object.keys(values).length){
    for(const key of KEYS)legacyStorage.removeItem(key);
    bridge.clearLegacyStorage?.();
  }
  return {
    getItem:key=>Object.hasOwn(values,key)?values[key]:null,
    setItem(key,value){
      if(!KEYS.includes(key)||typeof value!=='string')throw Error('지원하지 않는 저장 항목입니다.');
      if(values[key]===value)return;
      const next={...values,[key]:value};save(next);values=next;
    }
  };
}
