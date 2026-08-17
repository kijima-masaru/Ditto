# Ditto Remote — Android実機/エミュレータ検証 引き継ぎメモ

このファイルは、Android Studioをセットアップした**別PC**でセッションを引き継ぐための資料です。
PC側(Ditto本体)とAndroidアプリ(`mobile/`)は実装済みですが、**実機/エミュレータでの動作確認はまだ行われていません**。このマシンで初めて検証します。

## 現在の状態(要約)

- **PC側(`src/main/remoteServer.ts`ほか)**: 完全に実装・検証済み。`scripts/simulate-remote-client.mjs`(Node製のスマホ代替クライアント)を使い、ペアリング→暗号化された`listItems`/`triggerTemplate`/`triggerMacro`→デバイス失効まで、実際に動いているDittoアプリに対して一通り成功を確認済み。追加で、不正な6桁コードの拒否(`invalid-or-expired-code`)、同一IPからの5回失敗によるレート制限(`rate-limited`、60秒ブロック)も実機(このWindows PC)で再確認済み。
- **Android側(`mobile/`)**: Expo(React Native, TypeScript)でペアリング画面・ホーム画面・暗号通信クライアントを実装済み。`npx tsc --noEmit`はエラーなし、`npm install`も完了済み(このリポジトリをcloneし直した場合は`node_modules`が無いので`cd mobile && npm install`が必要)。
- **静的に確認済み(実機なしでの追加検証)**: `mobile/node_modules/expo-crypto`と`mobile/node_modules/expo-camera`にインストールされている実際の`.d.ts`型定義を直接読み、`mobile/src/lib/crypto.ts`(`AESEncryptionKey.import`/`AESSealedData.fromParts`/`aesEncryptAsync`/`aesDecryptAsync`)と`mobile/src/screens/PairingScreen.tsx`(`CameraView`の`barcodeScannerSettings`/`onBarcodeScanned`/`facing`、`useCameraPermissions`)の呼び出しシグネチャが実際のパッケージのAPIと完全に一致することを確認済み。ドキュメント調査ベースではなく、インストール済みパッケージの型定義と1行ずつ突き合わせた結果なので、API不一致による`decrypt-failed`等は考えにくい。
- **iOS対応で共通コードに変更が入っている(2026-08-17)**: `mobile/IOS_HANDOFF.md`のとおりiOS固有の対応を入れた際、iOS/Android共通のファイルにも手が入っている。**Androidの挙動は変えていないつもりだが、検証時に違和感があればここを疑うこと**。
  - `src/lib/wsClient.ts`: 接続処理を`openSocketOnce()`に切り出し、**iOSのみ**再試行+タイムアウトを行うようにした(`Platform.OS === 'ios'`で分岐。Androidは従来どおり1回で判定)。併せて、再試行で見捨てたソケットのcloseが生きている接続を切断扱いにしないようガードを追加した。
  - `src/lib/secureStorage.ts`: `keychainAccessible`オプションを追加(**iOS専用オプションのためAndroidでは無視される**)。
  - `src/screens/PairingScreen.tsx` / `HomeScreen.tsx`: 上端余白を`src/lib/layout.ts`の`SCREEN_TOP_PADDING`に切り出した(**Androidは従来と同じ60**)。ペアリング画面を`KeyboardAvoidingView`化したが`behavior`はiOSのみ指定(Androidは`undefined`=素のView相当)。既定の端末名は`Platform.OS`で分岐(Androidは従来どおり`Androidスマホ`)。
  - `app.json`: 追加した設定は`ios`セクションと各config pluginのiOS向けpropsのみ。ただし`npm run android`が`expo start --android`から`expo run:android`に変わっている(`expo prebuild`実行時にExpoが自動で書き換えたもの。このメモが指示している`npx expo run:android`と同じ動作になる)。
- **APK(ネイティブ)ビルドは一度も成功していない(2026-08-17時点)**: 「Androidバンドルの生成を確認済み」と書いてあるのは`expo export`によるJSバンドルの生成のことで、**Gradleを回してAPKを作る工程は未実施**。JSバンドル生成とネイティブプロジェクト生成(`expo prebuild --platform android`)までは通ることを確認済み。
  - Linuxコンテナ上で実際にAPKビルドを試みたが、**組織のegressポリシーで`dl.google.com`が403で遮断されており断念した**。Android SDK本体も、`google()`Mavenリポジトリの実体(`maven.google.com`→`dl.google.com/dl/android/maven2`へリダイレクト)も同じホストにあるため、SDKの取得もAGP/androidxの依存解決もできない。`services.gradle.org`と`repo1.maven.org`は到達可能なので、遮断されているのはGoogleのホストだけ。
  - **Android Studioのある通常のPC(Windows/Mac/Linuxいずれでも可)なら普通にビルドできるはず**なので、このPCでは`npx expo run:android`をそのまま実行すればよい。
- **`android.package`を`com.kijimamasaru.dittoremote`に固定した**: `expo prebuild`が生成するapplication idを明示的にピン留めしたもの(iOS側の`bundleIdentifier`と対になる)。
- **不要だった`RECORD_AUDIO`権限を落とした**: `expo-camera`のconfig pluginは`recordAudioAndroid`が既定`true`のため、指定しないと生成されるAndroidManifestに`android.permission.RECORD_AUDIO`が入る。このアプリはQRスキャンにしかカメラを使わず音声は一切扱わないため`recordAudioAndroid: false`を指定した。生成されるAndroidManifestから`RECORD_AUDIO`が消え、`CAMERA`と`INTERNET`だけになることを確認済み。
- **未検証(このPCでの最優先タスク)**: 上記の静的検証によりAPI不一致の可能性は低いと考えられるが、それでも物理Android端末/エミュレータ上での実際の動作(ネイティブモジュールの実行時挙動、パーミッションダイアログ、実際のLAN通信)はまだ一度も試していない。特に:
  1. `expo-crypto`のAES-GCM暗号化/復号が実機で実際に成功するか(型は合っているが、ネイティブ実装側の挙動は未確認)。
  2. `expo-camera`のQRスキャンが実機で実際に反応するか(SDKバージョンによっては無効化される不具合が報告されている。型は合っている)。
  3. PC(このリポジトリのDitto)とAndroid実機が同一LAN上でWebSocket(`ws://<IP>:58211/ws`)で実際に繋がるか(Windowsファイアウォールの初回許可ダイアログが出る想定)。

## このPCでの事前セットアップ

1. **Android Studio**(Standardインストールタイプ。Android SDK・AVDエミュレータが含まれる)をインストール。
2. **JDK 17**をインストール(Android Studioのセットアップウィザードで一緒に案内されることが多い)。
3. このリポジトリを取得(clone、または既存クローンを`git pull`)。
4. `cd mobile && npm install`(依存関係の再インストール。`node_modules`はgit管理外)。

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

## うまく動かない場合に確認すること

- **PC側Dittoの再起動がうまくいかない(ハマりポイント)**: `npm start`で起動したDittoのプロセス名は`electron.exe`ではなく**`Ditto.exe`**。`taskkill //IM electron.exe //F`では終了できず、単一インスタンスロックにより新しい`npm start`が古いプロセスに掴まれて`remoteServer`が起動しない(ポート58211がbindされない)ことがある。再起動する際は`taskkill //IM Ditto.exe //F`を使うこと。PC側ログ(`%APPDATA%\auto-test-tool\logs\main-<日付>.log`)に`[remoteServer] Ditto Remote listening on port 58211`が出ているか確認すると切り分けやすい。
- **接続できない**: Windowsファイアウォールの許可ダイアログが出ていないか(初回のみ出るはず)。PCとAndroidが本当に同一LAN/サブネットにいるか(モバイルデータ通信がOFFになっているか)。
- **QRスキャンが反応しない**: `mobile/src/screens/PairingScreen.tsx`の`CameraView`設定を見直す。Expo SDKのバージョンによる既知の不具合の可能性があるため、手入力モードで代替できるか確認する。
- **`decrypt-failed`が返る**: `mobile/src/lib/crypto.ts`のexpo-crypto API呼び出しが、インストールされているExpo SDKバージョンの実際のシグネチャと一致しているか確認する(`node_modules/expo-crypto`の型定義を直接確認するのが早い)。PC側の対応実装は`src/main/remoteCrypto.ts`。
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

## 完了したらやること

このPCでの検証が一通り終わったら、修正・確認内容を簡潔にコミットし、このファイルの「未検証」節を実際の結果(成功した/ここが直った/ここが未解決)に書き換えてpushしておくと、元のセッション(Windows開発機)側でも状況を追える。
