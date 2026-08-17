# Ditto Remote — Android実機/エミュレータ検証 引き継ぎメモ

このファイルは、Android Studioをセットアップした**別PC**でセッションを引き継ぐための資料です。
PC側(Ditto本体)とAndroidアプリ(`mobile/`)は実装済みですが、**実機/エミュレータでの動作確認はまだ行われていません**。このマシンで初めて検証します。

## 現在の状態(要約)

- **PC側(`src/main/remoteServer.ts`ほか)**: 完全に実装・検証済み。`scripts/simulate-remote-client.mjs`(Node製のスマホ代替クライアント)を使い、ペアリング→暗号化された`listItems`/`triggerTemplate`/`triggerMacro`→デバイス失効まで、実際に動いているDittoアプリに対して一通り成功を確認済み。
- **Android側(`mobile/`)**: Expo(React Native, TypeScript)でペアリング画面・ホーム画面・暗号通信クライアントを実装済み。`npx tsc --noEmit`はエラーなし、`npm install`も完了済み(このリポジトリをcloneし直した場合は`node_modules`が無いので`cd mobile && npm install`が必要)。
- **未検証(このPCでの最優先タスク)**: 物理Android端末またはエミュレータ上での実際の動作。特に以下3点は「コードは書いたが実機で動くか未確認」:
  1. `expo-crypto`のAES-GCM API(`AESEncryptionKey.import`/`aesEncryptAsync`/`aesDecryptAsync`ほか、`src/lib/crypto.ts`参照)が実際にこのシグネチャで動くか。Expo SDK 57時点の新機能で、ドキュメント調査ベースで実装しており実機での動作未確認。
  2. `expo-camera`の`CameraView`+`onBarcodeScanned`によるQRスキャンが実際に機能するか(SDKバージョンによっては無効化される不具合が報告されている)。
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
