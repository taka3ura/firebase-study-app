import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { firebaseConfig } from "./config.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const genAI = new GoogleGenerativeAI(firebaseConfig.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const BOT_ICON =
  "https://res.cloudinary.com/dee34nq47/image/upload/v1751473623/2_2_afbiq3.png";
const questions = [
  "ITパスポートの勉強を始めるにあたって、一番期待しているメリットは何ですか？（例：就活でのアピール、入社後の資格手当、実務の予習など）",
  `ITパスポートには3つの分野があります。どれが一番『仕事で役立ちそう』または『面白そう』だと思いますか？
ストラテジー（会社の仕組みや経営戦略）
マネジメント（プロジェクトの進め方や運用）
テクノロジー（PCやネットの技術的な仕組み）`,
];

let currentStep = 0;
let userAnswers = [];
let isAiResponding = false;
let unsubscribe = null;

function showWelcomeMessage() {
  const output = document.getElementById("output");
  output.innerHTML = `
          <div class="msg-container bot">
            <img class="icon" src="${BOT_ICON}">
            <div>
              <div class="bot-name">Gemini先生</div>
              <div class="bubble">ログインして、ITパスポート学習の「目的」を一緒に見つけましょう！</div>
            </div>
          </div>`;
}
showWelcomeMessage();

// ログイン・ログアウトのイベントハンドラー
document.getElementById("loginBtn").onclick = () =>
  signInWithPopup(auth, provider);
document.getElementById("logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("userProfile").style.display = "block";
    document.getElementById("displayName").innerText = user.displayName;

    subscribeToMessages(user.uid);

    // 1. 履歴を確認（自分宛て、または自分が送った全メッセージ）
    const q = query(
      collection(db, "messages"),
      where("targetUid", "==", user.uid),
    );
    const snapshot = await getDocs(q);

    // 2. 「メッセージが空」＝「初めての利用」のときだけ質問を送る
    if (snapshot.empty) {
      await addMessageToFirestore(
        "gemini-bot",
        "Gemini先生",
        BOT_ICON,
        questions[0],
        user.uid,
      );
      currentStep = 0;
      userAnswers = [];
    } else {
      // 3. すでに履歴がある場合は、既存データからcurrentStepなどを復元
      const userMsgs = snapshot.docs.filter((d) => d.data().uid === user.uid);
      userAnswers = userMsgs.map((d) => d.data().text);
      currentStep = userMsgs.length;
    }
  } else {
    document.getElementById("loginBtn").style.display = "block";
    document.getElementById("userProfile").style.display = "none";
    if (unsubscribe) unsubscribe();
    showWelcomeMessage();
    currentStep = 0;
    userAnswers = [];
  }
});

document.getElementById("sendBtn").onclick = async () => {
  const input = document.getElementById("message");
  const text = input.value.trim();
  const user = auth.currentUser;
  if (!user || !text || isAiResponding) return;

  isAiResponding = true;
  input.value = "";

  // 1. ユーザーのメッセージを保存
  await addMessageToFirestore(
    user.uid,
    user.displayName,
    user.photoURL,
    text,
    user.uid,
  );

  userAnswers.push(text);

  try {
    // 2. 次の質問または要約を生成
    if (currentStep < questions.length - 1) {
      const nextStep = currentStep + 1;
      const prompt = `あなたは心理学に基づく学習アドバイザーです。相手の名前は「${user.displayName}」さんです。ユーザーの回答「${text}」をポジティブに受け止めてから、次の質問「${questions[nextStep]}」をしてください。`;
      const result = await model.generateContent(prompt);
      await addMessageToFirestore(
        "gemini-bot",
        "Gemini先生",
        BOT_ICON,
        result.response.text(),
        user.uid,
      );
      currentStep++;
    } else {
      const finalPrompt = `これまでの対話（1: ${userAnswers[0]}, 2: ${userAnswers[1]}）から、「${user.displayName}」さんのITパスポート学習の目的の本質を分かり易いように箇条書きにまとめてください。（）・で箇条書きで書いてください。*はつかわないで。そして最後にITパスポート取得に向けて応援メッセージを一言お願いします。`;
      const result = await model.generateContent(finalPrompt);
      await addMessageToFirestore(
        "gemini-bot",
        "Gemini先生",
        BOT_ICON,
        `✨【ITパスポートの勉強をする目的】✨\n\n${result.response.text()}`,
        user.uid,
      );
    }
  } catch (e) {
    console.error("Gemini Error:", e);
  } finally {
    isAiResponding = false;
  }
};

async function addMessageToFirestore(uid, name, img, text, targetUid) {
  await addDoc(collection(db, "messages"), {
    uid,
    name,
    profileImg:
      img ||
      "https://www.gstatic.com/images/branding/product/2x/avatar_square_blue_120dp.png",
    text,
    time: serverTimestamp(), // クライアントの時間ではなくサーバーの時間を使う
    targetUid,
  });
}

function subscribeToMessages(userUid) {
  const q = query(
    collection(db, "messages"),
    where("targetUid", "==", userUid),
  );

  unsubscribe = onSnapshot(q, (snapshot) => {
    const output = document.getElementById("output");
    const docs = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        // timeがnull（保存中）の場合は最後に持ってくる
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time.seconds - b.time.seconds;
      });

    output.innerHTML = "";
    docs.forEach((data) => {
      const isBot = data.uid === "gemini-bot";
      const isVision = data.text.includes("My Vision");
      output.innerHTML += `
              <div class="msg-container ${isBot ? "bot" : "user"}">
                <img class="icon" src="${data.profileImg}">
                <div>
                  <div class="bot-name">${data.name}</div>
                  <div class="bubble ${isVision ? "vision-card" : ""}">${data.text}</div>
                </div>
              </div>`;
    });
    output.scrollTop = output.scrollHeight;
  });
}
