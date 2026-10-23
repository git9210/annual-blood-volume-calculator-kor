"""Real importer/service regression tests with host Android fakes.
Does not execute Android's native PDF decryption or render a device UI.
All certificate text and passwords below are synthetic test fixtures.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {}
def add(name, code):
    SOURCES[name.replace(".", "/") + ".java"] = "package " + name.rsplit(".", 1)[0] + ";\n" + code

add("android.os.IBinder", "public interface IBinder {}")
add("android.os.RemoteException", "public class RemoteException extends Exception {}")
add("android.os.Looper", "public class Looper { public static Looper getMainLooper(){return new Looper();} }")
add("android.os.Build", "public class Build { public static class VERSION { public static int SDK_INT=36; } }")
add("android.os.Process", """public class Process {
 public static int killed; public static final int THREAD_PRIORITY_BACKGROUND=10;
 public static void setThreadPriority(int priority){} public static int myPid(){return 7;}
 public static void killProcess(int pid){killed++;}
}""")
add("android.os.Bundle", """public class Bundle {
 public final java.util.Map<String,Object> values=new java.util.HashMap<>();
 public void putParcelable(String k,Object v){values.put(k,v);}
 @SuppressWarnings("unchecked") public <T> T getParcelable(String k){return (T)values.get(k);}
 public void putCharArray(String k,char[] v){values.put(k,v);}
 public char[] getCharArray(String k){return (char[])values.get(k);}
 public void putString(String k,String v){values.put(k,v);}
 public String getString(String k,String fallback){return (String)values.getOrDefault(k,fallback);}
 public void remove(String k){values.remove(k);}
 public Bundle copy() throws java.io.IOException {
  Bundle out=new Bundle();for(var e:values.entrySet()){
   Object v=e.getValue();
   if(v instanceof char[])v=((char[])v).clone();
   if(v instanceof ParcelFileDescriptor)v=ParcelFileDescriptor.dup(((ParcelFileDescriptor)v).getFileDescriptor());
   out.values.put(e.getKey(),v);
  }return out;
 }
}""")
add("android.os.Message", """public class Message {
 public int what,arg1,arg2;public Messenger replyTo;private Bundle data=new Bundle();
 public static Message obtain(Object unused,int kind){Message m=new Message();m.what=kind;return m;}
 public Bundle getData(){return data;}public void setData(Bundle value){data=value;}
 public Message copy() throws java.io.IOException {Message m=obtain(null,what);m.arg1=arg1;m.arg2=arg2;m.replyTo=replyTo;m.data=data.copy();return m;}
}""")
add("android.os.Handler", """public class Handler {
 public interface Callback{boolean handleMessage(Message m);}
 public final Callback callback;
 private static final java.util.Queue<Runnable> queue=new java.util.concurrent.ConcurrentLinkedQueue<>();
 private static final java.util.List<Runnable> delayed=new java.util.ArrayList<>();
 public Handler(Looper loop){callback=null;}public Handler(Looper loop,Callback cb){callback=cb;}
 public void post(Runnable fn){queue.add(fn);}public void postDelayed(Runnable fn,long ms){delayed.add(fn);}
 public void removeCallbacks(Runnable fn){delayed.remove(fn);}
 public static void drain(){Runnable fn;while((fn=queue.poll())!=null)fn.run();}
 public static void timeOut(){var copy=new java.util.ArrayList<>(delayed);delayed.clear();for(Runnable fn:copy)fn.run();}
 public static int delayedCount(){return delayed.size();}
}""")
add("android.os.Messenger", """public class Messenger {
 static class Binder implements IBinder{final Handler h;Binder(Handler h){this.h=h;}}
 final Handler handler;
 public static final java.util.List<char[]> passwordArrays=new java.util.ArrayList<>();
 public static Message lastRead;
 public Messenger(Handler h){handler=h;}public Messenger(IBinder b){handler=((Binder)b).h;}
 public IBinder getBinder(){return new Binder(handler);}
 public void send(Message m) throws RemoteException {
  try{
   Message copy=m.copy();
   if(m.what==1){lastRead=copy;if(m.getData().getCharArray("password")!=null){
    passwordArrays.add(m.getData().getCharArray("password"));passwordArrays.add(copy.getData().getCharArray("password"));
   }}
   handler.post(()->handler.callback.handleMessage(copy));
  }catch(java.io.IOException e){throw new RemoteException();}
 }
}""")
add("android.os.ParcelFileDescriptor", """public class ParcelFileDescriptor implements AutoCloseable {
 public static int opened,closed;private boolean isClosed;private final java.io.FileDescriptor fd=new java.io.FileDescriptor();
 public ParcelFileDescriptor(){opened++;}
 public java.io.FileDescriptor getFileDescriptor(){if(isClosed)throw new IllegalStateException();return fd;}
 public static ParcelFileDescriptor dup(java.io.FileDescriptor fd) throws java.io.IOException{return new ParcelFileDescriptor();}
 public void close() throws java.io.IOException{if(!isClosed){closed++;isClosed=true;}}
}""")
add("android.system.OsConstants", "public class OsConstants { public static final int SEEK_END=2,SEEK_SET=0; }")
add("android.system.Os", "public class Os {public static long size=1000;public static long lseek(java.io.FileDescriptor fd,long offset,int whence){return whence==2?size:0;}}")
add("android.net.Uri", "public class Uri {public String getScheme(){return \"content\";}public static Uri parse(String s){return new Uri();}}")
add("android.content.Context", "public class Context {public static final int BIND_AUTO_CREATE=1;}")
add("android.content.ComponentName", "public class ComponentName {}")
add("android.content.ActivityNotFoundException", "public class ActivityNotFoundException extends RuntimeException {}")
add("android.content.ServiceConnection", """public interface ServiceConnection {
 void onServiceConnected(ComponentName name,android.os.IBinder binder);
 void onServiceDisconnected(ComponentName name);
 default void onNullBinding(ComponentName name){}
 default void onBindingDied(ComponentName name){}
}""")
add("android.content.Intent", """public class Intent {
 public static final String ACTION_OPEN_DOCUMENT="open",CATEGORY_OPENABLE="openable",EXTRA_LOCAL_ONLY="local",EXTRA_ALLOW_MULTIPLE="multiple";
 public static final int FLAG_GRANT_READ_URI_PERMISSION=1;public boolean local,multiple;public int flags;public String type;
 public Intent(String action){}public Intent(Object context,Class<?> type){}
 public void addCategory(String s){}public void setType(String s){type=s;}
 public void putExtra(String key,boolean value){if(key.equals(EXTRA_LOCAL_ONLY))local=value;else multiple=value;}
 public void addFlags(int f){flags|=f;}
}""")
add("android.content.ContentResolver", """public class ContentResolver {
 public android.os.ParcelFileDescriptor openFileDescriptor(android.net.Uri uri,String mode){return new android.os.ParcelFileDescriptor();}
}""")
add("android.content.res.Resources", """public class Resources {
 public static class Metrics{public float density=1;}
 public Metrics getDisplayMetrics(){return new Metrics();}
}""")
add("android.app.Service", """public class Service {
 public android.os.IBinder onBind(android.content.Intent intent){return null;}
 public void onDestroy(){}
}""")
add("android.app.Activity", """public class Activity {
 public android.content.Intent picked;public android.content.ServiceConnection connection;
 public kr.bloodnote.app.CertificateService service;public boolean bindingAllowed=true;
 public java.io.File getCacheDir(){return new java.io.File(System.getProperty("java.io.tmpdir"),"nonexistent-certificate-test-cache");}
 public android.content.res.Resources getResources(){return new android.content.res.Resources();}
 public android.content.ContentResolver getContentResolver(){return new android.content.ContentResolver();}
 public void startActivityForResult(android.content.Intent intent,int code){picked=intent;}
 public boolean bindService(android.content.Intent intent,android.content.ServiceConnection c,int flags){
  if(!bindingAllowed)return false;connection=c;service=new kr.bloodnote.app.CertificateService();
  var active=service;new android.os.Handler(android.os.Looper.getMainLooper()).post(()->c.onServiceConnected(new android.content.ComponentName(),active.onBind(intent)));return true;
 }
 public void unbindService(android.content.ServiceConnection c){if(service!=null)service.onDestroy();service=null;connection=null;}
}""")
add("android.content.DialogInterface", """public interface DialogInterface {
 interface OnClickListener{void onClick(DialogInterface d,int which);}
 interface OnDismissListener{void onDismiss(DialogInterface d);}
 interface OnCancelListener{void onCancel(DialogInterface d);}
}""")
add("android.view.View", """public class View {
 public static final int IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS=8;
 public interface OnClickListener{void onClick(View view);}
}""")
add("android.view.WindowManager", "public class WindowManager {public static class LayoutParams {public static final int FLAG_SECURE=8192;}}")
add("android.view.Window", "public class Window {public int flags;public void addFlags(int f){flags|=f;}}")
add("android.view.inputmethod.EditorInfo", "public class EditorInfo {public static final int IME_ACTION_DONE=6,IME_FLAG_NO_PERSONALIZED_LEARNING=16,IME_FLAG_NO_EXTRACT_UI=32;}")
add("android.text.InputFilter", "public interface InputFilter {class LengthFilter implements InputFilter {public int max;public LengthFilter(int max){this.max=max;}}}")
add("android.text.InputType", "public class InputType {public static final int TYPE_CLASS_TEXT=1,TYPE_TEXT_VARIATION_PASSWORD=128,TYPE_TEXT_FLAG_NO_SUGGESTIONS=16;}")
add("android.text.Editable", """public class Editable implements CharSequence {
 private final StringBuilder s=new StringBuilder();
 public void clear(){s.setLength(0);}public void append(String value){s.append(value);}
 public int length(){return s.length();}public char charAt(int n){return s.charAt(n);}
 public CharSequence subSequence(int a,int b){return s.subSequence(a,b);}public String toString(){return s.toString();}
}""")
add("android.text.TextUtils", """public class TextUtils {
 public static void getChars(CharSequence from,int a,int b,char[] out,int offset){for(int i=a;i<b;i++)out[offset+i-a]=from.charAt(i);}
}""")
add("android.widget.EditText", """public class EditText extends android.view.View {
 public interface EditorListener{boolean onAction(EditText v,int action,Object event);}
 public boolean save=true,freezes=true;public int autofill,ime,type;public String error;public android.text.InputFilter[] filters;
 private final android.text.Editable text=new android.text.Editable();public EditorListener editor;
 public EditText(android.app.Activity app){}public void setSingleLine(boolean b){}public void setHint(String s){}
 public void setInputType(int n){type=n;}public void setSaveEnabled(boolean b){save=b;}public void setFreezesText(boolean b){freezes=b;}
 public void setImportantForAutofill(int n){autofill=n;}public void setImeOptions(int n){ime=n;}
 public void setFilters(android.text.InputFilter[] f){filters=f;}
 public android.text.Editable getText(){return text;}public int length(){return text.length();}
 public void setText(String s){text.clear();text.append(s);}public void setError(String s){error=s;}
 public void setOnEditorActionListener(EditorListener e){editor=e;}public void requestFocus(){}
}""")
add("android.widget.LinearLayout", """public class LinearLayout extends android.view.View {
 public android.view.View child;public LinearLayout(android.app.Activity a){}public void setPadding(int a,int b,int c,int d){}
 public void addView(android.view.View v,LayoutParams p){child=v;}
 public static class LayoutParams{public LayoutParams(int w,int h){}}
}""")
add("android.widget.Button", """public class Button extends android.view.View {
 public OnClickListener listener;public void setOnClickListener(OnClickListener l){listener=l;}
 public void click(){if(listener!=null)listener.onClick(this);}
}""")
add("android.app.AlertDialog", """public class AlertDialog implements android.content.DialogInterface {
 public static final int BUTTON_POSITIVE=-1;public static AlertDialog last;
 public boolean visible,outside;public String title,message;public android.widget.LinearLayout layout;
 public OnClickListener negative;public OnDismissListener dismissed;public OnCancelListener cancelled;
 final android.widget.Button button=new android.widget.Button();final android.view.Window window=new android.view.Window();
 public android.widget.Button getButton(int which){return button;}public android.view.Window getWindow(){return window;}
 public void setOnDismissListener(OnDismissListener l){dismissed=l;}public void setOnCancelListener(OnCancelListener l){cancelled=l;}
 public void setCanceledOnTouchOutside(boolean b){outside=b;}public void show(){visible=true;last=this;}
 public void dismiss(){if(!visible)return;visible=false;if(dismissed!=null)dismissed.onDismiss(this);}
 public void cancel(){if(cancelled!=null)cancelled.onCancel(this);dismiss();}
 public static class Builder {
  final AlertDialog d=new AlertDialog();public Builder(Activity a){}
  public Builder setTitle(String s){d.title=s;return this;}public Builder setMessage(String s){d.message=s;return this;}
  public Builder setView(android.widget.LinearLayout v){d.layout=v;return this;}
  public Builder setPositiveButton(String s,OnClickListener l){return this;}
  public Builder setNegativeButton(String s,OnClickListener l){d.negative=l;return this;}
  public AlertDialog create(){return d;}
 }
}""")
add("org.json.JSONObject", """public class JSONObject {
 public static String quote(String s){return "\\\""+s.replace("\\\\","\\\\\\\\").replace("\\\"","\\\\\\\"")+"\\\"";}
}""")
add("android.graphics.pdf.LoadParams", """public class LoadParams {
 public String password;public static class Builder{
  final LoadParams p=new LoadParams();public Builder setPassword(String s){p.password=s;return this;}public LoadParams build(){return p;}
 }
}""")
add("android.graphics.pdf.content.PdfPageTextContent", """public class PdfPageTextContent {
 public String getText(){return android.graphics.pdf.PdfRenderer.text;}
}""")
add("android.graphics.pdf.PdfRenderer", r"""public class PdfRenderer implements AutoCloseable {
 public static volatile String expectedPassword;public static volatile boolean damaged,hold,entered,unsafeError;
 public static String text="헌혈확인증명서(개인)\n성명 테스트인 생년월일 1990-01-01\nNO. 1/1\n헌혈횟수 1 사용용도 조회용\n번호 증서번호 헌혈종류 헌혈일자 헌혈장소\n1 99-20-000001 혈소판 2020-02-29 테스트센터";
 public PdfRenderer(android.os.ParcelFileDescriptor fd) throws java.io.IOException{this(fd,null);}
 public PdfRenderer(android.os.ParcelFileDescriptor fd,LoadParams params) throws java.io.IOException{
  entered=true;
  while(hold){try{Thread.sleep(1);}catch(InterruptedException e){throw new java.io.IOException();}}
  if(damaged)throw new java.io.IOException();
  if(unsafeError)throw new IllegalArgumentException("SYNTHETIC-PRIVATE-METADATA");
  if(expectedPassword!=null&&(params==null||!expectedPassword.equals(params.password)))throw new SecurityException();
 }
 public int getPageCount(){return 1;}public Page openPage(int n){return new Page();}public void close(){}
 public static class Page implements AutoCloseable {
  public java.util.List<android.graphics.pdf.content.PdfPageTextContent> getTextContents(){return java.util.List.of(new android.graphics.pdf.content.PdfPageTextContent());}
  public void close(){}
 }
}""")
add("kr.bloodnote.app.CertificatePasswordTest", r"""import android.app.Activity;
import android.app.AlertDialog;
import android.os.Handler;
import android.os.Message;
import android.os.Messenger;
import android.os.ParcelFileDescriptor;
import android.graphics.pdf.PdfRenderer;
import android.widget.EditText;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;

public class CertificatePasswordTest {
 static int checks;
 static void check(boolean ok){checks++;if(!ok)throw new AssertionError("check "+checks);}
 static void until(BooleanSupplier done) throws Exception{
  long end=System.nanoTime()+3_000_000_000L;
  do{Handler.drain();if(done.getAsBoolean())return;Thread.sleep(1);}while(System.nanoTime()<end);
  throw new AssertionError("timed out at check "+checks);
 }
 static class Fixture {
  final Activity app=new Activity();final List<String> phases=new ArrayList<>(),payloads=new ArrayList<>();
  final CertificateImporter importer=new CertificateImporter(app,(p,j)->{phases.add(p);payloads.add(j);});
  Fixture(){importer.resume();}
  void select(){importer.choose();importer.pause();importer.selected(android.net.Uri.parse("content://local/file"));importer.resume();}
  boolean has(String phase){return phases.contains(phase);}
  String payload(String phase){return payloads.get(phases.lastIndexOf(phase));}
 }
 static EditText input(AlertDialog d){return (EditText)d.layout.child;}
 static void wiped(){for(char[] p:Messenger.passwordArrays)for(char c:p)check(c=='\0');}
 public static void main(String[] args) throws Exception{
  // Plain documents do not prompt, and only parser-approved fields reach the UI.
  Fixture plain=new Fixture();plain.select();until(()->plain.has("ready"));
  check(!plain.has("password"));check(plain.payload("ready").contains("\"type\":\"platelet\""));
  check(!plain.payload("ready").contains("테스트인")&&!plain.payload("ready").contains("1990-01-01"));
  check(plain.app.service==null);check(plain.app.picked.local&&!plain.app.picked.multiple);
  check(plain.app.picked.flags==1&&plain.app.picked.type.equals("application/pdf"));

  PdfRenderer.expectedPassword="synthetic-test-password";
  Fixture f=new Fixture();f.select();until(()->AlertDialog.last!=null&&AlertDialog.last.visible);
  AlertDialog first=AlertDialog.last;EditText field=input(first);
  check(f.has("password")&&!f.has("ready"));check(Handler.delayedCount()==0);
  check(!field.save&&!field.freezes&&field.autofill==8);
  check((field.ime&16)!=0&&(field.type&128)!=0);check((first.getWindow().flags&8192)!=0&&first.outside);
  check(first.message.contains("저장하거나 전송하지 않습니다"));check(field.length()==0);
  first.getButton(-1).click();check(field.error!=null&&first.visible);
  field.setText("wrong-password");first.getButton(-1).click();
  check(field.length()==0&&!first.visible);until(()->AlertDialog.last!=first&&AlertDialog.last.visible);
  AlertDialog retry=AlertDialog.last;check(retry.title.contains("다시 확인"));check(input(retry).length()==0);
  check(!f.has("ready")&&!f.has("error"));
  input(retry).setText("synthetic-test-password");input(retry).editor.onAction(input(retry),6,null);
  until(()->f.has("ready"));check(input(retry).length()==0&&!retry.visible);check(f.app.service==null);
  for(String payload:f.payloads)check(!payload.contains("synthetic-test-password")&&!payload.contains("wrong-password"));
  wiped();

  // A late response from a canceled operation cannot finish an import.
  Fixture cancel=new Fixture();cancel.select();until(()->AlertDialog.last!=retry&&AlertDialog.last.visible);
  AlertDialog canceled=AlertDialog.last;Message old=Messenger.lastRead;
  input(canceled).setText("discard-this");canceled.cancel();
  check(cancel.has("cancelled")&&!canceled.visible&&input(canceled).length()==0);
  check(cancel.app.service==null);canceled.getButton(-1).click();check(!cancel.has("ready"));
  Message late=Message.obtain(null,CertificateService.DONE);late.arg1=old.arg1;late.arg2=old.arg2;
  late.getData().putString("payload","{}");old.replyTo.send(late);Handler.drain();check(!cancel.has("ready"));
  cancel.select();until(()->AlertDialog.last!=canceled&&AlertDialog.last.visible);
  AlertDialog fresh=AlertDialog.last;check(input(fresh).length()==0&&!fresh.title.contains("다시 확인"));
  old.replyTo.send(late);Handler.drain();check(!cancel.has("ready")&&fresh.visible);
  input(fresh).setText("private-input");cancel.importer.pause();
  check(!fresh.visible&&input(fresh).length()==0&&cancel.app.service==null);
  fresh.getButton(-1).click();cancel.importer.resume();check(!cancel.has("ready"));

  // Waiting for a password may cross onActivityResult -> onResume without losing the prompt.
  Fixture background=new Fixture();background.importer.choose();background.importer.pause();
  background.importer.selected(android.net.Uri.parse("content://local/file"));until(()->background.has("password"));
  check(!AlertDialog.last.visible);background.importer.resume();check(AlertDialog.last.visible);
  background.importer.cancel();check(!AlertDialog.last.visible);

  // Cancellation while parsing, time limit, malformed files and old Android are bounded failures.
  PdfRenderer.expectedPassword=null;PdfRenderer.hold=true;PdfRenderer.entered=false;
  Fixture timed=new Fixture();timed.select();until(()->PdfRenderer.entered);
  Handler.timeOut();check(timed.has("error")&&timed.app.service==null);
  PdfRenderer.hold=false;until(()->ParcelFileDescriptor.opened==ParcelFileDescriptor.closed);
  check(!timed.has("ready"));
  PdfRenderer.damaged=true;Fixture bad=new Fixture();bad.select();until(()->bad.has("error"));
  check(!bad.has("password")&&!bad.has("ready"));PdfRenderer.damaged=false;
  PdfRenderer.unsafeError=true;Fixture unsafe=new Fixture();unsafe.select();until(()->unsafe.has("error"));
  check(!unsafe.payload("error").contains("SYNTHETIC-PRIVATE-METADATA"));PdfRenderer.unsafeError=false;
  android.system.Os.size=20_000_001;Fixture large=new Fixture();large.select();until(()->large.has("error"));
  check(large.payload("error").contains("20MB"));android.system.Os.size=1000;
  Fixture unsupported=new Fixture();android.os.Build.VERSION.SDK_INT=34;unsupported.importer.choose();
  check(unsupported.has("error")&&unsupported.app.picked==null);android.os.Build.VERSION.SDK_INT=36;
  until(()->ParcelFileDescriptor.opened==ParcelFileDescriptor.closed);
  check(Handler.delayedCount()==0);wiped();
  System.out.println("PASS: "+checks+" password/import/lifecycle checks (host Android fakes; not native PDF decryption).");
 }
}""")

with tempfile.TemporaryDirectory(prefix="certificate-password-tests-") as temp:
    directory = Path(temp)
    files = []
    for name, source in SOURCES.items():
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
        files.append(str(path))
    files += [str(ROOT / "src/kr/bloodnote/app" / (name + ".java"))
              for name in ["CertificateImporter", "CertificateService", "CertificateParser"]]
    subprocess.run(["java", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-encoding", "UTF-8", "-d", temp, *files], check=True)
    subprocess.run(["java", "-cp", temp, "kr.bloodnote.app.CertificatePasswordTest"], check=True, timeout=30)
