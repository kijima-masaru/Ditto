# Ditto Remote — iOS対応 引き継ぎメモ

このファイルは、**Mac環境**でiOS版の実機/シミュレータ検証を引き継ぐための資料です。
iOS向けのビルド設定とiOS固有のコード対応は**済んでいます**が、**Xcodeでの実ビルドと実機/シミュレータでの動作確認は未実施**です(下記「未検証」節)。

## 現在の状態(要約)

- `mobile/`のExpo(React Native, TypeScript)プロジェクトはiOS/Android共通のコードで動く設計。以前は「Androidを主眼に実装、iOSは未着手」だったが、**iOS固有の設定・実装の対応を一通り入れ終えた**(下記「iOS対応として入れた変更」)。
- **PC側(`src/main/remoteServer.ts`)は変更不要**。プラットフォームを区別しない設計(WebSocket + AES-256-GCM)で、Androidシミュレータ代替(`scripts/simulate-remote-client.mjs`)で検証済み。iOS対応でPC側には一切手を入れていない。
- 直近の作業セッションは**Linuxコンテナ上で行われたため、Xcode/CocoaPods/シミュレータは使えなかった**。そのためMacが不要な範囲(設定の解決結果、ネイティブプロジェクトの生成、JSバンドルのビルド、型チェック、ネイティブ実装のソース確認)まで検証を進めてある。

## iOS対応として入れた変更

### 1. ローカルネットワーク許可(iOS 14+) — iOSで最も引っかかりやすい箇所

iOS 14以降、LAN内アドレスへの通信には**ローカルネットワークのユーザー許可が必要**で、`Info.plist`に`NSLocalNetworkUsageDescription`が無いと同一Wi-Fi上のPCに接続できない。Androidにこの制限は無いため、**Android版が動いてもiOS版だけ繋がらない**という形で出る。対応:

- `app.json`の`ios.infoPlist.NSLocalNetworkUsageDescription`に日本語の説明文を追加。
- さらにこの許可ダイアログは「LANへ接続しようとした瞬間に初めて表示され、表示中の接続はOSにブロックされる」ため、**初回の接続は必ず失敗し、ユーザーが「許可」を押したあとの再接続で初めて成功する**。そのため`src/lib/wsClient.ts`で、iOSのみ接続を1.5秒間隔で最大5回まで再試行するようにした(接続タイムアウト5秒付き。ブロックがエラーではなく無反応として現れた場合にも再試行できるようにするため)。Androidは従来どおり1回で判定する。
- ペアリング待ち画面に、iOSのときだけ「ローカルネットワーク上のデバイスの検索」の許可を促す案内を出すようにした。

### 2. iOSビルドに必要な設定(`app.json`)

- `ios.bundleIdentifier`に`com.kijimamasaru.dittoremote`を設定(未設定だと`expo run:ios`/`prebuild`が通らない)。**別のIDにしたい場合はここを変えてから`expo run:ios`すること**(Apple Developerアカウントで既に使っているIDと衝突する場合など)。
- `ios.infoPlist.ITSAppUsesNonExemptEncryption`に`false`を設定。TestFlight/App Storeへアップロードするたびに輸出コンプライアンスの質問が出るのを防ぐため。**標準の暗号化(CryptoKitのAES)のみを認証・通信保護に使う前提での申告なので、実際に配布する前に内容を確認すること。**
- **使っていない権限の宣言を削除**した。`expo-camera`/`expo-secure-store`の各config pluginは、指定しないと既定で`NSMicrophoneUsageDescription`(英語)と`NSFaceIDUsageDescription`(英語)を`Info.plist`に入れてしまう。このアプリはマイクもFace IDも使わないため、`microphonePermission: false` / `faceIDPermission: false`を渡して落としてある。結果、生成される`Info.plist`が宣言する権限は**カメラ(QR読み取り)とローカルネットワークの2つだけ**になる。

### 3. iOS固有のUI挙動

- **キーボードが操作を塞ぐ問題**: iOSはキーボードが画面に重なる(Androidはウィンドウがリサイズされる)ため、手入力モードで「連携する」ボタンがキーボードに隠れる。さらに`number-pad`のキーボードにはiOSだと閉じるキーが無く、Androidの戻るボタンのような逃げ道も無いため操作不能になりうる。`PairingScreen`を`KeyboardAvoidingView`(iOSのみ`behavior="padding"`)にして解消した。IPアドレス欄はiOSで`numbers-and-punctuation`キーボード+`returnKeyType="done"`にしてある。
- **セーフエリアの二重取り**: ルートの`SafeAreaView`(react-native)はiOSでのみノッチ/Dynamic Island分を挿入し、Androidでは何もしない。両画面が`paddingTop: 60`を持っていたため、iOSでは上端が大きく間延びしていた。`src/lib/layout.ts`の`SCREEN_TOP_PADDING`(iOSは12、Androidは60)に切り出して解消した。
- **端末名**: PC側のペアリング済み一覧に出る既定名が`Androidスマホ`固定だったので、iOSでは`iPhone`になるようにした(プレースホルダも同様)。
- **暗い背景での視認性**: `keyboardAppearance="dark"`(iOS専用)を各入力欄に指定。ホーム画面の引っ張って更新のスピナーは既定のグレーが暗い背景で見えづらいので`tintColor`を明示した。

### 4. 認証情報の保存(iOSのKeychain)

`expo-secure-store`はiOSではKeychainを使うが、既定の`WHEN_UNLOCKED`だと**暗号化バックアップ経由で別の端末に復元される**。セッション鍵はPCの操作権限そのものなので、機種変更や復元で権限が移らないよう`WHEN_UNLOCKED_THIS_DEVICE_ONLY`を指定した(`src/lib/secureStorage.ts`)。このオプションはiOS専用でAndroidの挙動には影響しない。

### 5. その他

`npm run ios` / `npm run android`が`expo start --ios` / `--android`(Expo Go経由)から`expo run:ios` / `run:android`(development build)に変わっている。これは`expo prebuild`を実行した際にExpoが自動で書き換えたもので、`expo-crypto`のAESや`expo-secure-store`はネイティブモジュールを要求しExpo Goでは動かない可能性が高いため、両方の引き継ぎメモが指示している手順(`npx expo run:*`)と一致する方向の変更になっている。

## Macが無くても検証できた範囲(実施済み)

Androidセッションと同じ方針で、ドキュメントの記憶ではなく**インストール済みパッケージの実物**に対して確認した。

- `npx tsc --noEmit` — エラーなし。
- `npx expo export --platform ios` — **iOS向けJSバンドルのビルド成功**(Metro, 604モジュール, Hermes bytecode 1.5MB)。import誤りやモジュール解決の問題が無いことの確認。
- `npx expo prebuild --platform ios --no-install` — **iOSネイティブプロジェクト(`ios/`)の生成成功**。生成された`ios/DittoRemote/Info.plist`を直接読んで、`NSLocalNetworkUsageDescription`・`NSCameraUsageDescription`が日本語で入り、`NSMicrophoneUsageDescription`・`NSFaceIDUsageDescription`が消え、`ITSAppUsesNonExemptEncryption`が`false`になっていることを確認。`project.pbxproj`の`PRODUCT_BUNDLE_IDENTIFIER`も意図した値になっていた。確認後`ios/`は削除してある(`mobile/.gitignore`で`/ios`は除外されているのでコミット対象外。Mac側で`expo run:ios`すれば同じものが再生成される)。
- **App Transport Security**: 平文の`ws://`がATSに弾かれないか懸念だったが、Expoが生成する`Info.plist`は既定で`NSAppTransportSecurity.NSAllowsArbitraryLoads: true`を持つことを確認したので**追加設定は不要**(なおReact Native 0.86のiOS WebSocketは`React/CoreModules/RCTWebSocketModule.mm`でSocketRocket(`SRWebSocket`)を使っており、これはCFStreamベースでATSの管轄外)。将来App Storeへ出す場合は`NSAllowsArbitraryLoads`の扱いを見直すこと。
- **expo-cryptoのiOS実装**: `node_modules/expo-crypto/ios/AES/AesCryptoModule.swift`を読み、Apple **CryptoKitの`AES.GCM`**で実装されていること、nonceは既定12バイト、`AES.GCM.seal`/`open`をそのまま使っていることを確認。PC側(`src/main/remoteCrypto.ts`)のIV 12バイト/タグ16バイトと整合する。なお**`tagLength`オプションはiOS側の実装では読まれておらず無視される**(CryptoKitはタグ16バイト固定)。`mobile/src/lib/crypto.ts`は16を渡しているので一致する。
- `AESSealedData.fromParts(iv, ciphertext, tag)`はタグを別に受け取るオーバーロードが型定義に存在することを確認済み(`fromParts(iv, ciphertextWithTag, tagLength?)`と2種類ある)。PC側がタグを分けて送る現在のワイヤーフォーマットのままで正しい。

## 未検証(Macでの最優先タスク)

上記のとおり設定・コード・JSバンドル・ネイティブプロジェクト生成までは通っているが、**Xcodeでの実ビルド以降は一度も試していない**。

1. `pod install`(CocoaPods)とXcodeでのコンパイルが通るか。**Linuxでは実行できないため完全に未検証。**
2. `expo-crypto`のAES-GCM暗号化/復号がiOS実機で実際に成功するか(CryptoKit経由。型とSwift実装は確認済みだが、実行時のPC側との相互運用は未確認)。
3. **ローカルネットワーク許可ダイアログが実際に出るか、そして「許可」後に上記の再試行ロジックでちゃんと繋がるか**(iOSで最も怪しい箇所。再試行回数・間隔が足りなければ`src/lib/wsClient.ts`の`IOS_LOCAL_NETWORK_RETRIES`/`IOS_LOCAL_NETWORK_RETRY_INTERVAL_MS`を調整する)。
4. `expo-camera`のQRスキャンがiOS実機で反応するか、カメラ権限ダイアログが日本語の説明文付きで出るか。
5. `expo-secure-store`が`WHEN_UNLOCKED_THIS_DEVICE_ONLY`で正常に読み書きできるか(アプリ再起動後に再ペアリングなしで繋がるか)。
6. セーフエリアの見た目(`SCREEN_TOP_PADDING`のiOS値12が実機で妥当か。ノッチ機とDynamic Island機で確認したい)。

## Macでの事前セットアップ

1. **Xcode**(App Storeからインストール)+ Command Line Tools。
2. **CocoaPods**(`sudo gem install cocoapods`、またはHomebrewで`brew install cocoapods`)。
3. このリポジトリを取得(clone、または既存クローンをpull)。
4. `cd mobile && npm install`(`node_modules`はgit管理外)。
5. (実機で試す場合)Apple Developer Program登録($99/年)が実質必須。シミュレータのみなら不要。

## 動作確認の手順

### 1. PC側(Ditto本体)を起動する

Ditto本体はWindowsアプリ(`koffi`でWin32 APIを叩き、`uiohook-napi`/`nut-js`で操作を再生する)なので、**Mac上では動かない**。iOS検証時は次のどちらかになる:

- **同一LAN上のWindows PCでDittoを起動する**(現実的な構成)。そのPCで設定画面(歯車アイコン)→「スマホ連携(Ditto Remote)」→「ペアリングコードを表示」でQR+6桁コードを出す。iPhoneとそのPCが同じWi-Fi/サブネットにいること。
- PC側の挙動だけ確認したいなら`scripts/simulate-remote-client.mjs`(Node製の擬似クライアント)を使う。ただしこれはiOS側の検証にはならない。

### 2. iOSアプリをビルドして実機/シミュレータで起動する

```bash
cd mobile
npx expo run:ios              # シミュレータ
npx expo run:ios --device     # 接続した実機を選択
```

初回は`ios/`の生成と`pod install`で時間がかかる。

> **シミュレータでは検証しきれない点がある**: カメラが無いためQRスキャンは試せない(手入力モードで代替する)。またローカルネットワーク許可の挙動はMacのネットワーク権限に乗るため実機と異なる。**ローカルネットワーク許可とQRスキャンは実機で確認すること。**

### 3. ペアリング〜動作確認

1. iOSアプリを起動→「QRスキャン」タブでPC画面のQRを読み取る(またはIP/ポート/6桁コードを手入力)。
   - カメラ権限の確認が出たら「許可」。
   - **「"Ditto Remote"がローカルネットワーク上のデバイスの検索を求めています」が出たら「許可」**。初回接続はこのダイアログのせいで失敗するが、再試行ロジックが自動でやり直すのでそのまま待つ。
2. PC側に確認ダイアログ(「"○○" がこのPCとの連携を要求しています」)が出るので「許可」を押す。
3. iOSアプリがホーム画面に切り替わり、PC側でコマンドパレットに固定(ピン留め)した定型文・マクロがボタングリッドで表示されることを確認する。
   - 表示されない場合は、PC側のクリップボード/マクロ画面で該当項目を右クリック→「コマンドパレットに固定」してあるか確認する。
4. PC側の任意のテキスト入力欄(メモ帳等)にフォーカスした状態で、iOSアプリの定型文ボタンをタップ→実際にテキストが入力されることを確認する。
5. マクロボタンを長押し→PC側でマクロが実行され、`Notification`(「スマホからマクロ「○○」が実行されました」)が表示されることを確認する。
6. アプリを再起動しても再ペアリングなしで繋がることを確認する(Keychainからの復帰)。
7. PC設定画面の「スマホ連携」→ペアリング済み一覧に端末が表示されることを確認し、「×」で失効させる。iOS側で次の操作が失敗することを確認する。

## うまく動かない場合に確認すること

- **接続できない / ずっと「PC側の承認を待っています...」のまま**: まずローカルネットワーク許可を疑う。**設定アプリ → プライバシーとセキュリティ → ローカルネットワーク → Ditto Remote** がONになっているか確認する(一度拒否すると以後ダイアログは出ず、ここで手動ONするしかない)。次にPCとiPhoneが本当に同一LAN/サブネットにいるか(モバイルデータ通信がOFFか)、Windowsファイアウォールの許可ダイアログが出ていないか。PC側ログ(`%APPDATA%\auto-test-tool\logs\main-<日付>.log`)に`[remoteServer] Ditto Remote listening on port 58211`が出ているかで切り分けられる。
- **許可はONなのに繋がらない**: 再試行の待ち時間が足りない可能性がある。`src/lib/wsClient.ts`の`IOS_LOCAL_NETWORK_RETRIES`(既定4回追加=最大5回)と`IOS_LOCAL_NETWORK_RETRY_INTERVAL_MS`(既定1500ms)を増やして試す。
- **`decrypt-failed`が返る**: `mobile/src/lib/crypto.ts`とPC側`src/main/remoteCrypto.ts`のIV長(12)/タグ長(16)/base64の扱いを突き合わせる。CryptoKitはタグ16バイト固定で`tagLength`は無視されるため、PC側が16以外を使っていると必ず失敗する。
- **QRスキャンが反応しない**: シミュレータではカメラが無いので当然反応しない。実機で`PairingScreen.tsx`の`CameraView`設定(`barcodeScannerSettings`/`onBarcodeScanned`)を見直す。手入力モードで代替できるかも確認する。
- **`pod install`が失敗する**: CocoaPodsのバージョンを上げる、`cd ios && pod repo update`を試す。それでも駄目なら`rm -rf ios && npx expo prebuild --platform ios --clean`で作り直す。
- **プロトコルの型を変更した場合**: `mobile/src/lib/protocol.ts`と`src/shared/types.ts`(`RemoteClientMessage`/`RemoteServerMessage`等)は手動で同期する設計(2つの独立したnpmプロジェクトのため型を共有していない)。片方だけ変更すると通信が`decrypt-failed`等で弾かれるので注意。

## Android版との関係

Android版の検証(`mobile/ANDROID_HANDOFF.md`)はまだ完了していない。**`src/`配下のコードはiOS/Androidで共通なので、どちらかで見つかった問題はもう一方にも影響する。**特に暗号処理(`crypto.ts`)と通信(`wsClient.ts`)は完全に共通。上記のiOS対応でも共通部分に手を入れているので(`wsClient.ts`の接続処理、`secureStorage.ts`のオプション追加、両画面のレイアウト定数)、Android側の検証時はそちらのメモも参照すること。

## 参照ファイル

- PC側サーバー本体: `src/main/remoteServer.ts`
- PC側暗号処理: `src/main/remoteCrypto.ts`
- 共有プロトコル定義(PC側): `src/shared/types.ts`
- iOS/Android共通のエントリポイント: `mobile/App.tsx`
- 画面: `mobile/src/screens/PairingScreen.tsx`, `mobile/src/screens/HomeScreen.tsx`
- 通信クライアント(iOSの再試行ロジック入り): `mobile/src/lib/wsClient.ts`
- 暗号処理: `mobile/src/lib/crypto.ts`
- プロトコル定義(手動同期): `mobile/src/lib/protocol.ts`
- 認証情報の永続化(Keychainオプション): `mobile/src/lib/secureStorage.ts`
- 画面上端の余白定数: `mobile/src/lib/layout.ts`
- iOSビルド設定: `mobile/app.json`
- 開発用シミュレータ(スマホ無しでPC側だけ検証したい場合): `scripts/simulate-remote-client.mjs`

## 完了したらやること

検証結果(成功/失敗、iOS固有で必要だった修正)をこのファイルの「未検証」節に反映し、コミット・pushしておく。共通コードに手を入れた場合は`ANDROID_HANDOFF.md`にも影響範囲を書き足すこと。
