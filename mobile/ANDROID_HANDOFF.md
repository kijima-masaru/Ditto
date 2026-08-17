# Ditto Remote — Android実機/エミュレータ検証 引き継ぎメモ

**2026-08-17: Androidエミュレータ(Pixel 7 / Android 16 / x86_64)での検証が完了しました。** ペアリングからリモート操作、デバイス失効まで一通り動作しています。検証の過程で暗号処理まわりに致命的なバグが2件見つかり、修正済みです(下記「検証で見つかったバグ」参照)。

**残る未検証項目は、物理Android実機でのQRスキャンのみ**です(エミュレータの仮想カメラにQRコードを映すのが現実的でないため)。

**接続方式の方針**: 最初は「同一Wi-Fi」と「USB接続(`adb reverse`)」の2パターンで進める。外出先からの利用(クラウド中継サーバー経由)は、機密情報が第三者サーバーを経由する・運用コストが発生する等のトレードオフがあるため現時点では不採用。Bluetoothも、Node/Electron側のBLEライブラリが不安定になりやすく転送量も小さいため不採用。

## 現在の状態(要約)

- **PC側(`src/main/remoteServer.ts`ほか)**: 完全に実装・検証済み。`scripts/simulate-remote-client.mjs`(Node製のスマホ代替クライアント)を使い、ペアリング→暗号化された`listItems`/`triggerTemplate`/`triggerMacro`→デバイス失効まで、実際に動いているDittoアプリに対して一通り成功を確認済み。追加で、不正な6桁コードの拒否(`invalid-or-expired-code`)、同一IPからの5回失敗によるレート制限(`rate-limited`、60秒ブロック)も実機(このWindows PC)で再確認済み。
- **Android側(`mobile/`)**: Expo(React Native, TypeScript)で実装済み。**エミュレータ上での実動作を確認済み**(下記「検証済みの項目」)。

### 検証済みの項目(2026-08-17 / Pixel 7 AVD, Android 16, x86_64)

| 項目 | 結果 |
| --- | --- |
| `adb reverse`経由のWebSocket接続 | ✅ エミュレータでも実機と同様に機能する |
| ペアリング(6桁コード手入力→PC承認ダイアログ→デバイス登録) | ✅ |
| AES-256-GCMの相互運用(送信・受信の両方向) | ✅ **バグ2件を修正して成立**(下記) |
| 保存済み認証情報での自動再接続 | ✅ **バグ1件を修正して成立**(下記) |
| `listItems`(ピン留め項目の取得)/ プルして更新 | ✅ |
| 定型文タップ→PCのフォーカス中の入力欄にテキスト入力 | ✅ メモ帳に実際に入力されることを確認 |
| マクロ長押し→PCでマクロ実行+通知 | ✅ 「スマホからマクロ「s」が実行されました」を確認 |
| デバイス失効→即時切断→再認証時に`authFailed`→認証情報破棄 | ✅ |
| PC側Ditto再起動後の自動再接続(無操作での復帰) | ✅ **後から実装**(下記バグ5) |

### 未検証で残っている項目

1. **`expo-camera`のQRスキャン**。エミュレータの仮想カメラにQRコードを映すのが現実的でないため未検証。**物理実機での確認が必要な唯一の項目**。手入力モード/USB接続モードで代替できるため、ブロッカーではない。
2. **同一Wi-Fi(LAN)経由の接続**。今回は`adb reverse`経由(`127.0.0.1`)でのみ検証したため、`ws://<PCのIP>:58211/ws`での接続とWindowsファイアウォールの初回許可ダイアログは未確認。PC側の実装は接続経路を区別しないため、通る見込みは高い。
3. **iOS**。`IOS_HANDOFF.md`を参照。なお下記のバグ2件は`mobile/src/lib/crypto.ts`という**iOSと共通のファイル**で起きていたため、iOS側でも同じ修正が効く(ただしAndroid固有のネイティブ実装に起因する問題なので、iOSでは元のコードでも動いた可能性がある)。

## 事前セットアップ(2026-08-17に実際に踏んだ手順)

1. **Android Studio**をインストールし、初回起動ウィザードをStandardで完走する。
   - `winget install --id Google.AndroidStudio` で入れる場合、インストーラがUAC昇格を要求するため**管理者権限のターミナルから実行すること**。非対話セッションで実行するとwingetは終了コード0で「インストールが完了しました」と表示するが、実際にはインストールされない。
2. **JDK 17を別途用意する**。Android Studio同梱のJBRは新しすぎて使えない(現行はOpenJDK 25)。JDK 22以降は制限付きネイティブアクセス(JEP 472)により`:expo-modules-core:configureCMakeDebug`が`WARNING: A restricted method in java.lang.System has been called`で失敗する。React Native 0.86が公式に要求するのはJDK 17。
   - 管理者権限不要な方法: [Adoptium](https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse)のzipをユーザー領域に展開し、`JAVA_HOME`をそこへ向ける。
3. **ウィザードだけでは足りない2つを追加インストールする**。ウィザードはSDK Platform / Build-Tools / platform-tools / エミュレータ本体しか入れないため、以下が別途必要:
   - **cmdline-tools**(`sdkmanager` / `avdmanager`が入っている)。Android StudioのSDK Manager GUIから「Android SDK Command-line Tools」を追加するか、[公式zip](https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip)を`$ANDROID_HOME/cmdline-tools/latest/`へ展開する(`bin/`が直下に来る配置にすること)。
   - **システムイメージ**。これが無いとAVDを作成できない。`sdkmanager "system-images;android-36;google_apis;x86_64"`。
4. 環境変数を設定する。
   ```
   ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk
   JAVA_HOME    = <JDK 17を展開した場所>
   PATH に追加   = %ANDROID_HOME%\platform-tools, %ANDROID_HOME%\emulator,
                  %ANDROID_HOME%\cmdline-tools\latest\bin, %JAVA_HOME%\bin
   ```
5. このリポジトリを取得(clone、または既存クローンを`git pull`)。
6. `npm install`(リポジトリルート)と`cd mobile && npm install`。`node_modules`はgit管理外。
   - **ルート側で`npm start`が`Error: Electron uninstall`で落ちる場合**、Electron本体のバイナリを取得するpostinstallがスキップされている。`cd node_modules/electron && node install.js`で取得できる。

### AVDの作成

```bash
avdmanager create avd -n Ditto_Test -k "system-images;android-36;google_apis;x86_64" -d pixel_7
```

`Error: Could not load devices from .../devices.xml`が出るが**無視してよい**(デバイスプロファイルは正しく適用され、AVD自体は作成される)。

作成後、`%USERPROFILE%\.android\avd\Ditto_Test.avd\config.ini`を編集して以下を変更しておくと検証しやすい:

| 設定 | 既定値 | 推奨値 | 理由 |
| --- | --- | --- | --- |
| `hw.gpu.enabled` / `hw.gpu.mode` | `no` / `auto` | `yes` / `host` | ソフトウェア描画だと極端に遅い |
| `hw.keyboard` | `no` | `yes` | 6桁コードをPCのキーボードから直接打てる |
| `hw.ramSize` | `2G` | `4096` | RNのdevビルドには2GBは手狭 |

## 動作確認の手順

### 1. PC側(Ditto本体)を起動する

このPCで直接Dittoを動かす場合(推奨、最も簡単):

```bash
cd 自動テストツール   # リポジトリルート
npm install
npm run start          # electron-vite preview でdevビルドを起動
```

設定画面(歯車アイコン) → 「スマホ連携(Ditto Remote)」→「ペアリングコードを表示」でQRコード+6桁コードが表示される。

> 別PCにあるDittoに接続したい場合は、そのPCと同一LANに接続し、そちらでペアリングコードを表示すればよい(IPアドレスはQRの中身、または手入力モードで直接入力できる)。

### 2. Androidアプリをビルドして実機/エミュレータで起動する

```bash
cd mobile
npx expo run:android
```

初回はAndroid SDKのライセンス同意やGradleのダウンロードで時間がかかる。実機を使う場合はUSBデバッグを有効にしてPCとAndroid端末を同一Wi-Fiに接続しておくこと。

> `npx expo start`でExpo Go経由の起動も試せるが、`expo-crypto`のAES機能や`expo-secure-store`がネイティブモジュールを要求する場合はExpo Goでは動作しない可能性が高い(未検証)。動かない場合は素直に`expo run:android`のdevelopment buildを使うこと。

### 3. ペアリング〜動作確認

1. Androidアプリを起動→「QRスキャン」タブでPC画面のQRを読み取る(またはIP/ポート/6桁コードを手入力)。
2. PC側に確認ダイアログ(「"○○" がこのPCとの連携を要求しています」)が出るので「許可」を押す。
3. Androidアプリがホーム画面に切り替わり、PC側でコマンドパレットに固定(ピン留め)した定型文・マクロがボタングリッドで表示されることを確認する。
   - 表示されない場合は、PC側のクリップボード/マクロ画面で該当項目を右クリック→「コマンドパレットに固定」してあるか確認する。
4. PC側の任意のテキスト入力欄(メモ帳等)にフォーカスした状態で、Androidアプリの定型文ボタンをタップ→実際にテキストが入力されることを確認する。
5. マクロボタンを長押し(ホールド確認)→PC側でマクロが実行され、`Notification`(「スマホからマクロ「○○」が実行されました」)が表示されることを確認する。
6. PC設定画面の「スマホ連携」→ペアリング済み一覧に端末が表示されることを確認し、「×」で失効させる。Android側で次の操作(再接続やトリガー)が失敗することを確認する。

### 4. USB接続で確認する場合(同一Wi-Fiが使えない環境向け)

PC側の`remoteServer.ts`は変更不要。`adb reverse`でスマホ側の`localhost:58211`をPCの`58211`番ポートへトンネルするだけで、同一LAN接続と全く同じWebSocketサーバーにUSB経由で到達できる。

1. AndroidをUSBデバッグでPCに接続した状態で、PC側ターミナルで以下を実行:
   ```bash
   adb reverse tcp:58211 tcp:58211
   ```
2. Androidアプリのペアリング画面で「USB接続」タブを選ぶ(host/portの入力は不要、`127.0.0.1:58211`固定)。
3. PC側で表示されている6桁コードを入力して「連携する」。
4. 以降の確認手順(定型文/マクロトリガー・デバイス失効)は同一Wi-Fi接続時と同じ。

> `adb reverse`はUSBケーブルを挿し直すかPC/端末を再起動すると解除されるため、再接続できない場合はまず`adb reverse --list`で設定が残っているか確認し、無ければコマンドを再実行する。

## 検証で見つかったバグ(すべて修正済み)

### 1. `ciphertext()`がbase64を返さない — 送信方向が全滅していた

```ts
sealed.ciphertext({ includeTag: false, encoding: 'base64' })  // 型定義は Promise<string>
// → Androidネイティブ実装は encoding オプションを無視して Uint8Array を返す
```

`JSON.stringify`すると`data`が`{"0":60,"1":32,...}`というobjectになり、PC側の`Buffer.from(envelope.data, 'base64')`がゴミを掴んで必ず`decrypt-failed`になっていた。`iv()`/`tag()`はencodingを**位置引数**で取るため正常に文字列を返す。オプションオブジェクトで受け取る`ciphertext()`だけが壊れている。

### 2. `AESSealedData.fromParts()`がbase64文字列のtagを受け付けない — 受信方向が全滅していた

```
Error: [fromParts] Cannot convert 'x6v7d2Ym...' to a Kotlin type
```

型定義は`BinaryInput = string | Uint8Array | ArrayBuffer`で「文字列ならbase64」と明記しているが、Androidネイティブ実装はtagにStringを渡すと例外を投げる。3引数目が`BinaryInput`(tag)と`number`(tagLength)のオーバーロードになっている都合と思われる。

**1と2はどちらも「型定義と実装の乖離」なので`tsc --noEmit`では検出できない。** 以前このファイルに「インストール済みパッケージの型定義と1行ずつ突き合わせたのでAPI不一致は考えにくい」と書いていたが、手法は妥当でも前提(型定義が実装を正しく表している)が誤っていた。**型定義の突き合わせだけでネイティブモジュールの相互運用性を判断してはいけない。**

対処として`mobile/src/lib/crypto.ts`にbase64のエンコーダ/デコーダを自前で持ち、戻り値がstringでもUint8Arrayでも正しく扱えるよう正規化した。固定の鍵・IV・平文でNode実装(`src/main/remoteCrypto.ts`)と突き合わせ、両方向とも1バイト単位で一致することを確認済み。

> **同種の問題を調べる方法**: 固定の鍵・IV・平文をNode側(`node -e`で`createCipheriv`)とアプリ側の両方に通し、`console.log`の出力をlogcatで突き合わせるのが最も速い。デバッグビルドならMetro経由でJSの変更が即反映されるため、Gradleの再ビルドは不要。

### 3. counterのリセット方針がPC側とモバイル側で食い違っていた — 再接続が必ず失敗

PC側(`remoteServer.ts`の`deviceCounters`)はリプレイ対策として**再接続をまたいでcounterの単調増加を要求**する。一方モバイル側は`connectWithSavedCredentials()`で`counter = 0`にリセットしていたため、アプリを再起動すると`counter=1`で`auth`を送り、`1 <= lastCounter`で**無応答のまま破棄**されていた。ペアリング直後でも`1 <= 1`が成立するため初回の再起動で必ず発生する。

対処: モバイル側は`secureStorage`にcounterの上限をブロック単位(1000個)で予約・永続化し、再接続時はその値から再開する。PC側はリプレイ検出時に無応答で`return`せず`authFailed` / `stale-counter`を返すようにした(無応答だと原因不明のハングになり切り分けが困難なため)。

### 4. その他の小さな修正

- 再接続時にステータス表示が「接続中...」のままだった(`handlePaired()`を通らない経路で`connected`に進めていなかった)。
- グリッドが空のとき`FlatList`ごと素の`View`に差し替えていたため、案内文が「下に引っ張って更新できます」と言っているのに`RefreshControl`が存在せず、実際には更新できなかった。`ListEmptyComponent`に変更。
- `authFailed`の各理由に対するユーザー向けメッセージが無く、無言で失敗していた(`App.tsx`の`authFailedMessage()`を追加)。
- `expo prebuild`が`app.json`に`RECORD_AUDIO`(マイク権限)を自動追加していた。expo-cameraの`recordAudioAndroid`が既定`true`のため。QRコードを読むだけなので`recordAudioAndroid: false` / `microphonePermission: false`で除去した。
- パッケージ名が`com.anonymous.dittoremote`(Expoのプレースホルダ)だったので`com.ditto.remote`に変更した。

### 5. 自動再接続が無く、切断中の操作が無反応だった(別コミットで修正)

`sendRaw()`が`this.ws?.send()`だったため、切断中(`ws === null`)にボタンを押しても何も起きずエラーも出なかった。かつ再接続の仕組みが無く、PC側のDittoを再起動するとアプリを手動で立ち上げ直すしかなかった。

対処:

- `ws.onclose`から指数バックオフ(1秒→倍化→上限30秒)で自動再接続する。
- `shouldReconnect`フラグを持ち、連携解除(`forget()`/`disconnect()`)後は再試行しない。`authFailed`の`unknown-device`/`revoked`を受けた時点でも再接続を打ち切る(何度繋ぎ直しても通らないため)。
- `sendRaw()`は切断中に例外を投げるようにし、`HomeScreen`側で未接続バナー表示+ボタン無効化+送信失敗メッセージを出す。

検証: PC側Dittoをプロセスごとkill→アプリに未接続バナーが出てボタンが無効化される→Dittoを再起動→**アプリを一切操作せずに自動復帰**し、定型文トリガーが通ることを確認済み。

### 6. ペアリング拒否時に承認待ちスピナーから永久に戻れなかった(別コミットで修正)

`client.startPairing()`は「`pair`メッセージを送信し終えた」時点で解決するため、PC側に拒否されても`PairingScreen`のローカルstate `connecting`が`true`のまま残る。`connecting`中はスピナーだけを描画する作りなので、`App.tsx`が`pairRejected`を受けて`pairError`をセットしても**エラーバナーを描画するコードに到達しない**。

影響範囲は広く、`pairRejectedMessage()`が用意していた4つの文言(`invalid-or-expired-code` / `denied-by-user` / `timeout` / `rate-limited`)は**どれも一度も表示されない**状態だった。復帰手段はアプリの再起動のみ。

対処: `PairingScreen`に`useEffect`を足し、`errorMessage`が入った時点で`connecting`/`scanned`を解除する。あわせて`startPairing()`の先頭で`onErrorDismiss()`を呼び、前回のエラーが残っていて即座に解除されてしまうのを防ぐ。

> **この種のバグを見逃した理由**: それまでの検証が成功パスしか通していなかったため。ペアリングは「わざと誤った6桁コードを入れる」だけで失敗系を試せるので、次から必ず両方確認すること。

## 既知の未対応事項

- デバイス失効の直後、アプリはホーム画面のまま「未接続」表示で項目も残る。失効を検知するのは次回の認証時。
- **原因未特定**: 検証中に一度、操作していないのにアプリ側の認証情報が消えてペアリング画面に戻る現象が起きた。PC側の`settings.json`にはデバイスが残っており(`lastSeenAt`も直前の時刻)、失効操作もしていない。エラーバナーも出ていなかったため`authFailed`経由ではない可能性が高い。再現条件が不明なため未修正。再発したらその時点の`adb logcat`を確保すること。

## うまく動かない場合に確認すること

- **PC側Dittoの再起動がうまくいかない(ハマりポイント)**: プロセス名は起動方法で変わる。`npm start`(`electron-vite preview`、未パッケージのdevビルド)では**`electron`**、`electron-builder`でパッケージ化したビルドでは**`Ditto.exe`**。単一インスタンスロックにより、古いプロセスが残っていると新しい`npm start`が`remoteServer`を起動できない(ポート58211がbindされない)ことがあるため、状況に応じて`taskkill //IM electron.exe //F`または`taskkill //IM Ditto.exe //F`を使い分けること。切り分けには以下が有効:
  - PC側ログ(`%APPDATA%\auto-test-tool\logs\main-<日付>.log`)に`[remoteServer] Ditto Remote listening on port 58211`が出ているか。
  - `Get-NetTCPConnection -LocalPort 58211` でLISTENしているか。接続中は`Established`、失効・切断後は`TimeWait`が見える。
  - なお同じ理由で、devビルドではマクロ実行通知の送信元アプリ名が「Ditto」ではなく**「Electron」**と表示される。
- **接続できない**: Windowsファイアウォールの許可ダイアログが出ていないか(初回のみ出るはず)。PCとAndroidが本当に同一LAN/サブネットにいるか(モバイルデータ通信がOFFになっているか)。
- **`wsClient.ts`を直したのに挙動が変わらない(ハマりポイント)**: MetroのFast Refreshは画面の再描画はするが、`App.tsx`が`useRef`で保持している`RemoteClient`インスタンスは作り直さない。そのため**画面まわりの修正だけ反映され、クライアント側のロジックは修正前の古いインスタンスのまま動く**という紛らわしい状態になる。実際にこれで「自動再接続が効かない」と誤判定しかけた。`wsClient.ts`など`useRef`が抱えるオブジェクトを変更したときは、Fast Refreshに頼らず`adb shell am force-stop com.ditto.remote`でアプリを完全に再起動して確認すること。
- **QRスキャンが反応しない**: `mobile/src/screens/PairingScreen.tsx`の`CameraView`設定を見直す。Expo SDKのバージョンによる既知の不具合の可能性があるため、手入力モードで代替できるか確認する。
- **`decrypt-failed`が返る**: まず上記「検証で見つかったバグ」の1・2を疑う。**型定義との突き合わせでは判断できない**ので、固定の鍵・IV・平文でNode側とアプリ側の出力を実際に突き合わせること。PC側の対応実装は`src/main/remoteCrypto.ts`。
- **プロトコルの型を変更した場合**: `mobile/src/lib/protocol.ts`と`src/shared/types.ts`(`RemoteClientMessage`/`RemoteServerMessage`等)は手動で同期する設計(2つの独立したnpmプロジェクトのため型を共有していない)。片方だけ変更すると通信が`decrypt-failed`等で弾かれるので注意。

## 参照ファイル

- PC側サーバー本体: `src/main/remoteServer.ts`
- PC側暗号処理: `src/main/remoteCrypto.ts`
- 共有プロトコル定義(PC側): `src/shared/types.ts`(`RemoteClientMessage`/`RemoteServerMessage`/`PairedDevice`等)
- Android側エントリポイント: `mobile/App.tsx`
- Android側画面: `mobile/src/screens/PairingScreen.tsx`, `mobile/src/screens/HomeScreen.tsx`
- Android側通信クライアント: `mobile/src/lib/wsClient.ts`
- Android側暗号処理: `mobile/src/lib/crypto.ts`
- Android側プロトコル定義(手動同期): `mobile/src/lib/protocol.ts`
- Android側認証情報の永続化: `mobile/src/lib/secureStorage.ts`
- 開発用シミュレータ(スマホ無しでPC側だけ検証したい場合): `scripts/simulate-remote-client.mjs`

## 次にやるとよいこと

1. **物理Android実機でQRスキャンを確認する**(唯一残っている未検証項目)。同時に同一Wi-Fi経由の接続とWindowsファイアウォールの許可ダイアログも確認できる。
2. **切断中の挙動を改善する**(上記「既知の未対応事項」)。自動再接続、または少なくとも「切断中です」というフィードバックを出す。
3. iOS対応(`IOS_HANDOFF.md`)。
