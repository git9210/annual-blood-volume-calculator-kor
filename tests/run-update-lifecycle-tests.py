"""Exercise the real metadata-only AppUpdater with host Android/JSON/HTTPS fakes.
No network, device installer, real Android runtime, or Play Protect verdict is tested.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {}

def add(name, body):
    package, _, simple = name.rpartition('.')
    SOURCES[name.replace('.', '/') + '.java'] = 'package ' + package + ';\n' + body

add('android.content.DialogInterface', '''public interface DialogInterface {
 interface OnClickListener {void onClick(DialogInterface d,int which);}
 interface OnDismissListener {void onDismiss(DialogInterface d);}
 interface OnCancelListener {void onCancel(DialogInterface d);}
}''')
add('android.content.ActivityNotFoundException', 'public class ActivityNotFoundException extends RuntimeException {}')
add('android.net.Uri', '''public final class Uri {
 private final String value;private Uri(String value){this.value=value;}
 public static Uri parse(String value){return new Uri(value);}public String toString(){return value;}
}''')
add('android.content.Intent', '''public class Intent {
 public static final String ACTION_VIEW="android.intent.action.VIEW",CATEGORY_BROWSABLE="android.intent.category.BROWSABLE";
 public String action;public android.net.Uri data;public Intent selector;
 public final java.util.Set<String> categories=new java.util.HashSet<>();
 public Intent(String a,android.net.Uri d){action=a;data=d;}public Intent addCategory(String c){categories.add(c);return this;}
 public void setSelector(Intent value){selector=value;}
}''')
add('android.content.pm.PackageInfo', 'public class PackageInfo {public String versionName="4.0.3";}')
add('android.content.pm.PackageManager', '''public class PackageManager {
 public final PackageInfo own=new PackageInfo();public PackageInfo getPackageInfo(String name,int flags){return own;}
}''')
add('android.app.Activity', '''public class Activity {
 public final android.content.pm.PackageManager manager=new android.content.pm.PackageManager();
 public final java.io.File cache;public int launches,failLaunch;public android.content.Intent launched;
 private final java.util.Queue<Runnable> queue=new java.util.concurrent.ConcurrentLinkedQueue<>();
 public Activity(java.io.File root){cache=root;}public java.io.File getCacheDir(){return cache;}
 public String getPackageName(){return "kr.bloodnote.app";}public android.content.pm.PackageManager getPackageManager(){return manager;}
 public void runOnUiThread(Runnable action){queue.add(action);}public void drain(){Runnable r;while((r=queue.poll())!=null)r.run();}
 public void startActivity(android.content.Intent i){
  if(failLaunch==1)throw new android.content.ActivityNotFoundException();if(failLaunch==2)throw new SecurityException();launches++;launched=i;
 }
}''')
add('android.app.AlertDialog', '''public class AlertDialog implements android.content.DialogInterface {
 public static final int BUTTON_NEGATIVE=-2;public static AlertDialog last;
 public boolean visible;public String title,message,positiveLabel;public OnClickListener positive,negative;public OnDismissListener dismissed;public OnCancelListener cancelled;
 public void setOnDismissListener(OnDismissListener c){dismissed=c;}public void setOnCancelListener(OnCancelListener c){cancelled=c;}
 public void show(){visible=true;last=this;}public void dismiss(){if(!visible)return;visible=false;if(dismissed!=null)dismissed.onDismiss(this);}
 public void clickPositive(){if(positive!=null)positive.onClick(this,1);dismiss();}
 public void clickNegative(){if(negative!=null)negative.onClick(this,-2);dismiss();}
 public void cancel(){if(cancelled!=null)cancelled.onCancel(this);dismiss();}
 public static class Builder {
  final AlertDialog d=new AlertDialog();public Builder(Activity app){}
  public Builder setTitle(String s){d.title=s;return this;}public Builder setMessage(String s){d.message=s;return this;}
  public Builder setPositiveButton(String s,OnClickListener c){d.positive=c;d.positiveLabel=s;return this;}
  public Builder setNegativeButton(String s,OnClickListener c){d.negative=c;return this;}public AlertDialog create(){return d;}
 }
}''')
add('android.app.ProgressDialog', '''public class ProgressDialog extends AlertDialog {
 public ProgressDialog(Activity app){}public void setTitle(String s){title=s;}public void setMessage(String s){message=s;}
 public void setIndeterminate(boolean value){}public void setCanceledOnTouchOutside(boolean value){}public void setCancelable(boolean value){}
 public void setButton(int code,String s,OnClickListener c){negative=c;}
}''')
add('org.json.JSONObject', '''public class JSONObject {
 public static final java.util.Map<String,JSONObject> fixtures=new java.util.concurrent.ConcurrentHashMap<>();
 private final java.util.Map<String,Object> values;
 public JSONObject(){values=new java.util.HashMap<>();}
 public JSONObject(String text){JSONObject o=fixtures.get(text);if(o==null)throw new IllegalArgumentException("unregistered JSON fixture");values=o.values;}
 public JSONObject put(String key,Object value){values.put(key,value);return this;}
 public boolean optBoolean(String key,boolean fallback){Object v=values.get(key);return v instanceof Boolean?(Boolean)v:fallback;}
 public String getString(String key){Object v=values.get(key);if(!(v instanceof String))throw new IllegalArgumentException(key);return (String)v;}
 public String optString(String key){Object v=values.get(key);return v instanceof String?(String)v:"";}
 public long getLong(String key){return ((Number)values.get(key)).longValue();}public JSONArray getJSONArray(String key){return (JSONArray)values.get(key);}
}''')
add('org.json.JSONArray', '''public class JSONArray {
 public final java.util.List<JSONObject> items=new java.util.ArrayList<>();public JSONArray add(JSONObject o){items.add(o);return this;}
 public int length(){return items.size();}public JSONObject getJSONObject(int n){return items.get(n);}
}''')
add('kr.bloodnote.app.UpdateLifecycleTest', '''public class UpdateLifecycleTest {
 static int checks,serial;static void check(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
 static final java.util.Queue<Response> responses=new java.util.concurrent.ConcurrentLinkedQueue<>();
 static final java.util.List<Connection> connections=new java.util.concurrent.CopyOnWriteArrayList<>();
 static class Response {
  int code=200;byte[] body;boolean block;final java.util.concurrent.CountDownLatch entered=new java.util.concurrent.CountDownLatch(1),gate=new java.util.concurrent.CountDownLatch(1);
  Response(String text){body=text.getBytes(java.nio.charset.StandardCharsets.UTF_8);}
 }
 static class Connection extends javax.net.ssl.HttpsURLConnection {
  final Response response;boolean disconnected;int reads;final java.util.Map<String,String> headers=new java.util.HashMap<>();
  Connection(java.net.URL url,Response r){super(url);response=r;connections.add(this);}
  public void setRequestProperty(String key,String value){headers.put(key,value);}
  public int getResponseCode()throws java.io.IOException {
   response.entered.countDown();if(response.block)try{response.gate.await();}catch(InterruptedException e){Thread.currentThread().interrupt();throw new java.io.IOException(e);}
   if(disconnected)throw new java.io.IOException("cancelled");return response.code;
  }
  public java.io.InputStream getInputStream(){reads++;return new java.io.ByteArrayInputStream(response.body);}
  public void disconnect(){disconnected=true;response.gate.countDown();}public boolean usingProxy(){return false;}public void connect(){}
  public String getCipherSuite(){return "test-only";}public java.security.cert.Certificate[] getLocalCertificates(){return null;}
  public java.security.cert.Certificate[] getServerCertificates(){return null;}
 }
 static android.app.Activity app()throws Exception{return new android.app.Activity(java.nio.file.Files.createTempDirectory("updater-case-").toFile());}
 static org.json.JSONObject asset(String tag){String name=UpdatePolicy.apkName(tag);return new org.json.JSONObject().put("name",name).put("size",358162L)
  .put("state","uploaded").put("browser_download_url",UpdatePolicy.RELEASES+"/download/"+tag+"/"+name);}
 static org.json.JSONObject release(String tag){return new org.json.JSONObject().put("tag_name",tag).put("draft",false).put("prerelease",false)
  .put("html_url","https://evil.example/ignored").put("assets",new org.json.JSONArray().add(asset(tag)));}
 static Response enqueue(org.json.JSONObject json){String key="fixture-"+(++serial);org.json.JSONObject.fixtures.put(key,json);Response r=new Response(key);responses.add(r);return r;}
 static Thread worker(AppUpdater u)throws Exception{
  var field=AppUpdater.class.getDeclaredField("task");field.setAccessible(true);Object task=field.get(u);if(task==null)return null;
  var thread=task.getClass().getDeclaredField("thread");thread.setAccessible(true);return (Thread)thread.get(task);
 }
 static void join(Thread thread)throws Exception{if(thread!=null){thread.join(5000);check(!thread.isAlive());}}
 static void finish(AppUpdater u,android.app.Activity a)throws Exception{join(worker(u));a.drain();}
 static android.app.AlertDialog consent(AppUpdater u){u.request();check(android.app.AlertDialog.last.visible);return android.app.AlertDialog.last;}
 static void start(AppUpdater u){consent(u).clickPositive();}
 static void error(org.json.JSONObject json,String message)throws Exception{
  var a=app();var u=new AppUpdater(a,()->true);int n=connections.size();enqueue(json);start(u);finish(u,a);
  check(connections.size()==n+1);check(android.app.AlertDialog.last.title.equals("업데이트 확인 중단"));
  check(android.app.AlertDialog.last.message.contains(message));check(a.launches==0);u.destroy();
 }
 public static void main(String[] args)throws Exception{
  java.net.URL.setURLStreamHandlerFactory(protocol->new java.net.URLStreamHandler(){protected java.net.URLConnection openConnection(java.net.URL url)throws java.io.IOException{
   if(!url.toString().equals("https://api.github.com/repos/git9210/annual-blood-volume-calculator-kor/releases/latest"))throw new AssertionError("unexpected network destination: "+url);
   Response r=responses.poll();if(r==null)throw new AssertionError("connection without test consent");return new Connection(url,r);
  }});
  var a=app();var dir=new java.io.File(a.cache,"app-update");dir.mkdir();var apk=new java.io.File(dir,"update.apk");java.nio.file.Files.writeString(apk.toPath(),"legacy");
  var record=new java.io.File(a.cache,"record.enc");java.nio.file.Files.writeString(record.toPath(),"unchanged");
  var u=new AppUpdater(a,()->true);check(!apk.exists());check(record.exists());check(connections.isEmpty());check(a.launches==0);
  var prompt=consent(u);check(prompt.message.contains("데이터 요금"));check(prompt.message.contains("헌혈 기록·계획·PDF·백업·암호는 보내지 않습니다"));
  u.request();check(android.app.AlertDialog.last==prompt);check(connections.isEmpty());prompt.clickNegative();check(connections.isEmpty());
  prompt=consent(u);u.pause();prompt.clickPositive();check(connections.isEmpty());
  boolean[] active={false};u=new AppUpdater(a,()->active[0]);u.request();check(connections.isEmpty());active[0]=true;
  enqueue(release("v4.0.4"));start(u);finish(u,a);var preview=android.app.AlertDialog.last;
  check(preview.title.equals("새 버전 v4.0.4"));check(preview.message.contains("349.8 KiB"));check(preview.message.contains("파일 검증을 수행하지 않습니다"));
  check(preview.message.contains("다운로드 폴더"));check(a.launches==0);check(connections.size()==1);
  var connection=connections.get(0);check(connection.getRequestMethod().equals("GET"));check(!connection.getInstanceFollowRedirects());check(!connection.getUseCaches());
  check(!connection.getDoOutput());check(connection.getConnectTimeout()==15000);check(connection.getReadTimeout()==20000);check(connection.disconnected);
  check(connection.headers.size()==4);check(!connection.headers.containsKey("Authorization"));
  preview.clickNegative();check(a.launches==0);
  enqueue(release("v4.0.4"));start(u);finish(u,a);android.app.AlertDialog.last.clickPositive();
  check(a.launches==1);check(a.launched.action.equals("android.intent.action.VIEW"));
  check(a.launched.data.toString().equals("https://github.com/git9210/annual-blood-volume-calculator-kor/releases/tag/v4.0.4"));
  check(a.launched.categories.contains("android.intent.category.BROWSABLE"));check(a.launched.selector.data.toString().equals("https://"));
  check(a.launched.selector.action.equals("android.intent.action.VIEW"));check(a.launched.selector.categories.contains("android.intent.category.BROWSABLE"));
  check(connections.size()==2);check(java.nio.file.Files.readString(record.toPath()).equals("unchanged"));check(!dir.exists());
  // Current/older releases have no browser handoff or downgrade.
  for(String tag:new String[]{"v4.0.3","v4.0.2"}){
   a=app();u=new AppUpdater(a,()->true);enqueue(release(tag));start(u);finish(u,a);
   check(android.app.AlertDialog.last.title.equals("업데이트 확인"));check(android.app.AlertDialog.last.positive==null);check(a.launches==0);u.destroy();
  }
  error(release("v4.0.4").put("draft",true),"정식 배포판");error(release("v4.0.4").put("prerelease",true),"정식 배포판");
  error(release("v4.0.4").put("tag_name","v4.0.4/../../other"),"확인하지 못했습니다");
  error(release("v4.0.4").put("assets",new org.json.JSONArray()),"Small APK가 없습니다");
  error(release("v4.0.4").put("assets",new org.json.JSONArray().add(asset("v4.0.4")).add(asset("v4.0.4"))),"배포 주소·이름·용량");
  for(org.json.JSONObject bad:new org.json.JSONObject[]{asset("v4.0.4").put("browser_download_url","https://evil.example/app.apk"),
      asset("v4.0.4").put("size",0L),asset("v4.0.4").put("state","starter")})
   error(release("v4.0.4").put("assets",new org.json.JSONArray().add(bad)),"배포 주소·이름·용량");
  for(int code:new int[]{301,302,403,404,429,500}){
   a=app();u=new AppUpdater(a,()->true);var r=enqueue(release("v4.0.4"));r.code=code;int n=connections.size();start(u);finish(u,a);
   check(connections.size()==n+1);check(connections.get(n).reads==0);check(android.app.AlertDialog.last.title.equals("업데이트 확인 중단"));check(a.launches==0);u.destroy();
  }
  for(int mode=0;mode<2;mode++){
   a=app();u=new AppUpdater(a,()->true);var r=new Response("invalid JSON");if(mode==1)r.body=new byte[UpdatePolicy.MAX_METADATA+1];responses.add(r);
   start(u);finish(u,a);check(android.app.AlertDialog.last.title.equals("업데이트 확인 중단"));check(a.launches==0);u.destroy();
  }
  // Cancelling an active connection stops the worker; no stale UI or browser handoff.
  a=app();u=new AppUpdater(a,()->true);var r=enqueue(release("v4.0.4"));r.block=true;start(u);
  check(r.entered.await(3,java.util.concurrent.TimeUnit.SECONDS));Thread t=worker(u);var progress=android.app.AlertDialog.last;
  u.request();check(android.app.AlertDialog.last==progress);progress.cancel();join(t);a.drain();check(!progress.visible);check(a.launches==0);
  check(connections.get(connections.size()-1).disconnected);
  // A result already queued when the activity pauses must also be ignored.
  a=app();u=new AppUpdater(a,()->true);enqueue(release("v4.0.4"));start(u);join(worker(u));u.pause();a.drain();check(!android.app.AlertDialog.last.visible);check(a.launches==0);
  // A dismissed preview cannot open later, even after activity foreground is restored.
  a=app();u=new AppUpdater(a,()->true);enqueue(release("v4.0.4"));start(u);finish(u,a);preview=android.app.AlertDialog.last;u.pause();preview.clickPositive();check(a.launches==0);
  for(int failure:new int[]{1,2}){
   a=app();a.failLaunch=failure;u=new AppUpdater(a,()->true);enqueue(release("v4.0.4"));start(u);finish(u,a);android.app.AlertDialog.last.clickPositive();
   check(a.launches==0);check(android.app.AlertDialog.last.title.equals("브라우저를 열 수 없습니다"));u.destroy();
  }
  check(responses.isEmpty());
  System.out.println("PASS: "+checks+" update consent/metadata/browser lifecycle checks (real AppUpdater, host Android/JSON/HTTPS fakes; no network/device/Play Protect).");
 }
}''')

with tempfile.TemporaryDirectory(prefix='update-lifecycle-tests-') as directory:
    folder = Path(directory)
    files = []
    for name, code in SOURCES.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(code)
        files.append(path)
    files += [ROOT / 'src/kr/bloodnote/app' / (name + '.java') for name in ['AppUpdater', 'UpdatePolicy']]
    subprocess.run(['java', '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-encoding', 'UTF-8', '-d', directory, *map(str, files)], check=True)
    subprocess.run(['java', '-Djava.io.tmpdir=' + directory, '-cp', directory, 'kr.bloodnote.app.UpdateLifecycleTest'], check=True)
