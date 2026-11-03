import React,{useCallback,useEffect,useMemo,useState} from "react";
import {ActivityIndicator,Alert,KeyboardAvoidingView,Platform,Pressable,RefreshControl,SafeAreaView,ScrollView,Share,StatusBar,StyleSheet,Text,TextInput,View} from "react-native";
import * as SecureStore from "expo-secure-store";
import {accountSnapshot,ApiError,changeWatchlist,login,logout,sendSupport,support,watchlist, type Snapshot,type SupportMessage,type WatchItem} from "./src/api";
import {amount,dateLabel,orderCsv,shares} from "./src/format";

type Tab="overview"|"positions"|"orders"|"watchlist"|"account";
const SESSION_KEY="nuvexapro_client_session_v1";
const COLORS={bg:"#101317",card:"#1b2027",edge:"#303946",text:"#edf1f7",muted:"#a0aab9",blue:"#55b7fa",green:"#22d5a0"};
const TABS:{key:Tab;label:string;icon:string}[]=[
  {key:"overview",label:"概览",icon:"⌂"},{key:"positions",label:"持仓",icon:"▤"},
  {key:"orders",label:"记录",icon:"⇄"},{key:"watchlist",label:"自选",icon:"☆"},{key:"account",label:"我的",icon:"◉"}
];
const MARKETS=[{code:"US",label:"美国"},{code:"HK",label:"香港"},{code:"CN",label:"中国内地"},{code:"MY",label:"马来西亚"}];
const readableError=(e:unknown)=>e instanceof Error?e.message:"发生未知错误";

function Panel({children}:{children:React.ReactNode}){return <View style={styles.panel}>{children}</View>;}
function Heading({children}:{children:React.ReactNode}){return <Text style={styles.heading}>{children}</Text>;}
function Hint({children}:{children:React.ReactNode}){return <Text style={styles.hint}>{children}</Text>;}
function Button({label,onPress,secondary=false,disabled=false}:{label:string;onPress:()=>void;secondary?:boolean;disabled?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[styles.button,secondary&&styles.buttonSecondary,disabled&&styles.disabled]}><Text style={[styles.buttonText,secondary&&styles.buttonSecondaryText]}>{label}</Text></Pressable>;
}
function Row({title,subtitle,right}:{title:string;subtitle?:string;right?:React.ReactNode}){
  return <View style={styles.item}><View style={styles.itemMain}><Text selectable style={styles.itemTitle}>{title}</Text>{subtitle?<Text style={styles.itemSub}>{subtitle}</Text>:null}</View>{right}</View>;
}
export default function App(){
  const [booting,setBooting]=useState(true),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false);
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[token,setToken]=useState<string|null>(null);
  const [tab,setTab]=useState<Tab>("overview"),[snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [items,setItems]=useState<WatchItem[]>([]),[error,setError]=useState("");
  const [query,setQuery]=useState(""),[market,setMarket]=useState("US"),[symbol,setSymbol]=useState("");
  const [supportMessages,setSupportMessages]=useState<SupportMessage[]>([]),[supportStatus,setSupportStatus]=useState(""),[message,setMessage]=useState("");
  const [supportBusy,setSupportBusy]=useState(false);
  useEffect(()=>{let active=true;SecureStore.getItemAsync(SESSION_KEY)
    .then(value=>{if(active)setToken(value);})
    .catch(()=>{if(active)setError("安全存储不可用，请检查设备设置。");})
    .finally(()=>{if(active)setBooting(false);});
    return()=>{active=false;};
  },[]);
  const revokeLocally=useCallback(async()=>{await SecureStore.deleteItemAsync(SESSION_KEY).catch(()=>{});setToken(null);setSnapshot(null);setItems([]);setSupportMessages([]);setTab("overview");},[]);
  const refresh=useCallback(async(currentToken:string)=>{
    setRefreshing(true);setError("");
    try {
      const data=await accountSnapshot(currentToken);
      setSnapshot(data);
      try{setItems(await watchlist(currentToken));}
      catch(e){setError("账户已加载，自选列表读取失败："+readableError(e));}
    } catch(e){
      if(e instanceof ApiError&&e.status===401)await revokeLocally();
      setError(readableError(e));
    } finally{setRefreshing(false);}
  },[revokeLocally]);
  useEffect(()=>{if(token)void refresh(token);},[token,refresh]);
  const loadSupport=useCallback(async(currentToken:string)=>{
    setSupportBusy(true);
    try{const data=await support(currentToken);setSupportMessages(data.messages);setSupportStatus(data.thread?.status||"未创建会话");}
    catch(e){setError("客服消息读取失败："+readableError(e));}
    finally{setSupportBusy(false);}
  },[]);
  useEffect(()=>{if(token&&tab==="account")void loadSupport(token);},[token,tab,loadSupport]);
  async function signIn(){
    if(!email.trim()||!password){setError("请输入账户邮箱及密码。");return;}
    setBusy(true);setError("");
    try{
      const session=await login(email,password);
      if(!session?.token)throw new Error("服务器没有返回有效会话。");
      await SecureStore.setItemAsync(SESSION_KEY,session.token);
      setPassword("");setToken(session.token);
    }catch(e){setError(readableError(e));}
    finally{setBusy(false);}
  }
  async function signOut(){
    const usedToken=token;
    if(!usedToken)return;
    setBusy(true);setError("");
    try{await logout(usedToken);}
    catch(e){setError("服务器退出请求未确认，本机登录凭证将被清除："+readableError(e));}
    finally{await revokeLocally();setBusy(false);}
  }
  async function addItem(){
    const upper=symbol.trim().toUpperCase();
    if(!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(upper)){setError("代码只允许大写英文字母、数字、点和连字符（1—24位）。");return;}
    if(!token)return;
    setBusy(true);setError("");
    try{await changeWatchlist(token,{market,symbol:upper});setItems(await watchlist(token));setSymbol("");}
    catch(e){setError(readableError(e));}finally{setBusy(false);}
  }
  async function removeItem(item:WatchItem){
    if(!token)return;
    setBusy(true);
    try{await changeWatchlist(token,{market:item.market,symbol:item.symbol},true);setItems(await watchlist(token));}
    catch(e){setError(readableError(e));}finally{setBusy(false);}
  }
  async function postSupport(){
    if(!token||!message.trim()||message.trim().length>4000)return;
    setSupportBusy(true);setError("");
    try{await sendSupport(token,message.trim());setMessage("");await loadSupport(token);}
    catch(e){setError(readableError(e));}
    finally{setSupportBusy(false);}
  }
  const filteredOrders=useMemo(()=>snapshot?.orders.filter(o=>(o.market+" "+o.symbol+" "+o.side).toLowerCase().includes(query.toLowerCase().trim()))||[],[snapshot,query]);
  if(booting)return <SafeAreaView style={styles.root}><StatusBar barStyle="light-content"/><View style={styles.center}><ActivityIndicator color={COLORS.blue}/><Hint>正在读取安全登录状态…</Hint></View></SafeAreaView>;
  return <SafeAreaView style={styles.root}><StatusBar barStyle="light-content"/>
    {!token?<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS==="ios"?"padding":undefined}>
      <ScrollView contentContainerStyle={styles.auth} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>Nuvexa<Text style={styles.logoAccent}>Pro</Text></Text>
        <Text style={styles.eyebrow}>CLIENT ACCOUNT · SECURE ACCESS</Text>
        <Heading>登录客户账户</Heading>
        <Hint>使用现有客户账户登录。账户内容只来自已验证的服务端记录。</Hint>
        <Panel>
          <Text style={styles.label}>电子邮箱</Text>
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#7e8a9c" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email"/>
          <Text style={styles.label}>登录密码</Text>
          <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#7e8a9c" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password"/>
          <Button label={busy?"正在登录…":"安全登录"} onPress={()=>void signIn()} disabled={busy}/>
        </Panel>
        {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
        <Hint>本 App 仅查看内部账户及业务记录，不提供真实证券交易服务。</Hint>
      </ScrollView>
    </KeyboardAvoidingView>:<>
      <View style={styles.topbar}><View><Text style={styles.brand}>Nuvexa<Text style={styles.logoAccent}>Pro</Text></Text><Text style={styles.eyebrow}>CLIENT WORKSPACE</Text></View><Pressable accessibilityRole="button" onPress={()=>token&&void refresh(token)}><Text style={styles.refresh}>↻ 刷新</Text></Pressable></View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{if(token)void refresh(token);}} tintColor={COLORS.blue}/>}>
        <View style={styles.disclosure}><Text style={styles.disclosureText}>内部账户记录 · 未连接真实券商或实时证券交易</Text></View>
        {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
        {tab==="overview"?<>
          <Heading>账户概览</Heading><Hint>余额及活动记录均由登录账户服务器提供，不显示模拟报价。</Hint>
          <Panel><Text style={styles.label}>账户账面余额</Text><Text style={styles.bigValue}>{snapshot?amount(snapshot.account.cashCents,snapshot.account.currency):"—"}</Text><Hint>该金额为内部账本记录，不代表托管资金证明。</Hint></Panel>
          <View style={styles.pair}><Panel><Text style={styles.label}>当前持仓条目</Text><Text style={styles.metric}>{snapshot?snapshot.positions.length:"—"}</Text></Panel><Panel><Text style={styles.label}>近期订单记录</Text><Text style={styles.metric}>{snapshot?snapshot.orders.length:"—"}</Text></Panel></View>
          <Panel><Heading>账户信息</Heading><Hint>{snapshot?.disclosure||"登录后同步账户记录。"}</Hint><Hint>交易/价格服务尚未接通；不会伪造执行成功或收益数字。</Hint></Panel>
        </>:null}
        {tab==="positions"?<>
          <Heading>持仓记录</Heading><Hint>只列出服务器记录的实际账户条目，不表示已经在券商处持有证券。</Hint>
          {!snapshot?<Panel><Hint>账户数据未同步。</Hint></Panel>:snapshot.positions.length===0?<Panel><Hint>当前没有持仓记录。</Hint></Panel>:snapshot.positions.map((p,i)=><Panel key={p.market+"-"+p.symbol+"-"+i}><Row title={p.symbol} subtitle={"市场："+p.market} right={<Text style={styles.amount}>{shares(p.quantity)} 股</Text>}/></Panel>)}
        </>:null}
        {tab==="orders"?<>
          <Heading>交易历史记录</Heading><Hint>仅账户内部历史记录，最多显示服务器返回的最近 100 条，不等于券商已成交订单。</Hint>
          <TextInput style={styles.input} placeholder="搜索市场、代码或方向" placeholderTextColor="#7e8a9c" value={query} onChangeText={setQuery}/>
          <Button secondary label="分享当前筛选的 CSV 文本" onPress={()=>void Share.share({message:orderCsv(filteredOrders)})} disabled={!snapshot||filteredOrders.length===0}/>
          {snapshot&&filteredOrders.length===0?<Panel><Hint>没有符合条件的交易记录。</Hint></Panel>:filteredOrders.map(o=><Panel key={o.id}><Row title={o.symbol+" · "+o.market} subtitle={dateLabel(o.created_at)} right={<Text style={[styles.amount,o.side==="BUY"&&styles.positive]}>{o.side==="BUY"?"买入记录":o.side==="SELL"?"卖出记录":o.side}</Text>}/><View style={styles.detailLine}><Hint>数量 {shares(o.quantity)}</Hint><Text style={styles.amount}>{amount(o.amount_usd_cents,"USD")}</Text></View><Hint>内部订单记录 / 未证实券商执行</Hint></Panel>)}
        </>:null}
        {tab==="watchlist"?<>
          <Heading>自选列表</Heading><Hint>四个市场代码只是服务器允许的代码分类，不代表四地行情已接通。</Hint>
          <Panel><Text style={styles.label}>选择市场分类</Text><View style={styles.marketWrap}>{MARKETS.map(m=><Pressable key={m.code} accessibilityRole="button" onPress={()=>setMarket(m.code)} style={[styles.marketButton,market===m.code&&styles.marketActive]}><Text style={styles.marketText}>{m.label}</Text></Pressable>)}</View>
            <TextInput style={styles.input} placeholder="输入证券代码（如 AAPL）" placeholderTextColor="#7e8a9c" autoCapitalize="characters" value={symbol} onChangeText={setSymbol}/>
            <Button label="添加自选" disabled={busy} onPress={()=>void addItem()}/></Panel>
          {items.length===0?<Panel><Hint>暂无自选代码。</Hint></Panel>:items.map(item=><Panel key={item.market+"-"+item.symbol}><Row title={item.symbol} subtitle={item.market+" · 尚无实时行情"} right={<Pressable accessibilityRole="button" accessibilityLabel={"删除"+item.symbol} disabled={busy} onPress={()=>void removeItem(item)}><Text style={styles.remove}>移除</Text></Pressable>}/></Panel>)}
        </>:null}
        {tab==="account"?<>
          <Heading>我的账户</Heading>
          <Panel><Text style={styles.label}>账户编号</Text><Text selectable style={styles.accountId}>{snapshot?.account.id||"—"}</Text><Hint>账户数据与其他登录用户隔离，由服务端校验归属。</Hint></Panel>
          <Panel><Heading>客服沟通</Heading><Hint>提交给已连接的客户支持服务，无法保证即时回复。</Hint><Hint>会话状态：{supportStatus||"未同步"}</Hint>
            {supportBusy?<ActivityIndicator color={COLORS.blue}/>:null}
            {supportMessages.slice(-20).map(m=><View style={styles.message} key={m.id}><Text style={styles.messageText}>{m.body}</Text><Hint>{dateLabel(m.createdAt)}</Hint></View>)}
            <TextInput style={[styles.input,styles.multiline]} multiline numberOfLines={3} maxLength={4000} placeholder="给客服留言" placeholderTextColor="#7e8a9c" value={message} onChangeText={setMessage}/>
            <Button disabled={supportBusy||message.trim().length===0||supportStatus==="CLOSED"} label="发送消息" onPress={()=>void postSupport()}/>
          </Panel>
          <Panel><Heading>账户安全</Heading><Hint>会话令牌仅保存在手机的安全存储中，退出时会尝试撤销服务器会话。</Hint><Button secondary disabled={busy} label="退出登录" onPress={()=>void signOut()}/></Panel>
          <Hint>正式上架前须补齐账号注销流程、隐私政策、审核测试账号及商店资料。</Hint>
        </>:null}
        <View style={{height:24}}/>
      </ScrollView>
      <View style={styles.bottomNav}>{TABS.map(t=><Pressable key={t.key} accessibilityRole="tab" accessibilityState={{selected:tab===t.key}} style={[styles.tab,tab===t.key&&styles.tabActive]} onPress={()=>{setError("");setTab(t.key);}}><Text style={[styles.tabIcon,tab===t.key&&styles.activeText]}>{t.icon}</Text><Text style={[styles.tabLabel,tab===t.key&&styles.activeText]}>{t.label}</Text></Pressable>)}</View>
    </>}
  </SafeAreaView>;
}
const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:COLORS.bg},flex:{flex:1},center:{flex:1,alignItems:"center",justifyContent:"center",gap:15},
  auth:{padding:24,paddingTop:90,gap:19,flexGrow:1,justifyContent:"center"},
  logo:{color:COLORS.text,fontSize:38,fontWeight:"500",letterSpacing:0.2},
  logoAccent:{color:"#efc78a"},eyebrow:{color:COLORS.muted,fontSize:10,letterSpacing:2,marginTop:3},
  brand:{color:COLORS.text,fontSize:22,fontWeight:"500"},heading:{color:COLORS.text,fontSize:21,fontWeight:"500",marginBottom:10},
  hint:{color:COLORS.muted,fontSize:12,lineHeight:20,marginTop:6},label:{color:COLORS.muted,fontSize:12,marginBottom:10},
  panel:{backgroundColor:COLORS.card,borderWidth:1,borderColor:COLORS.edge,borderRadius:16,padding:17,marginBottom:12,flex:1,minWidth:0},
  input:{borderWidth:1,borderColor:"#415065",color:COLORS.text,backgroundColor:"#111820",borderRadius:10,paddingHorizontal:13,paddingVertical:12,marginBottom:13,fontSize:14},
  multiline:{height:94,textAlignVertical:"top"},button:{borderRadius:11,backgroundColor:COLORS.blue,paddingVertical:13,paddingHorizontal:15,alignItems:"center",marginTop:5,marginBottom:5},
  buttonText:{fontWeight:"500",fontSize:14,color:"#06111b"},buttonSecondary:{backgroundColor:"#202e3d",borderWidth:1,borderColor:"#39516d"},
  buttonSecondaryText:{color:"#bde3ff"},disabled:{opacity:0.4},error:{color:"#ffad9e",backgroundColor:"#3a2225",padding:12,borderRadius:10,marginBottom:11,fontSize:13},
  topbar:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",paddingHorizontal:20,paddingVertical:13,borderBottomWidth:1,borderBottomColor:COLORS.edge},
  refresh:{color:COLORS.blue,fontSize:13},content:{padding:18,paddingBottom:30},
  disclosure:{borderColor:"#7a5f32",borderWidth:1,backgroundColor:"#302819",paddingHorizontal:12,paddingVertical:9,borderRadius:8,marginBottom:18},
  disclosureText:{color:"#efca88",fontSize:11,lineHeight:17},bigValue:{fontSize:29,color:COLORS.text,marginVertical:8,fontWeight:"500"},
  pair:{flexDirection:"row",gap:10},metric:{color:COLORS.text,fontSize:26,fontWeight:"500"},item:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:10},
  itemMain:{flex:1,minWidth:0},itemTitle:{color:COLORS.text,fontSize:15,fontWeight:"500"},itemSub:{fontSize:12,color:COLORS.muted,marginTop:6},
  amount:{color:COLORS.text,fontSize:13},positive:{color:COLORS.green},detailLine:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginTop:12},
  marketWrap:{flexDirection:"row",flexWrap:"wrap",gap:8,marginBottom:14},marketButton:{paddingHorizontal:12,paddingVertical:9,borderRadius:8,backgroundColor:"#27313d"},
  marketActive:{backgroundColor:"#315b7d",borderColor:COLORS.blue,borderWidth:1},marketText:{color:COLORS.text,fontSize:12},
  remove:{color:"#ffb3a5",fontSize:12,padding:6},accountId:{color:COLORS.text,fontSize:12,letterSpacing:0.3},
  message:{backgroundColor:"#111923",padding:12,borderRadius:9,marginBottom:8},messageText:{color:COLORS.text,fontSize:13,lineHeight:20},
  bottomNav:{flexDirection:"row",borderTopWidth:1,borderTopColor:COLORS.edge,backgroundColor:"#161c24",paddingVertical:7,paddingHorizontal:8},
  tab:{flex:1,alignItems:"center",paddingVertical:5,borderRadius:9},tabActive:{backgroundColor:"#263547"},
  tabIcon:{color:COLORS.muted,fontSize:21},tabLabel:{color:COLORS.muted,fontSize:10,marginTop:3},activeText:{color:COLORS.blue}
});
