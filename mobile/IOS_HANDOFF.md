# Ditto Remote — iOS対応 引き継ぎメモ

**2026-08-18: iOSシミュレータ(iPhone 17 Pro / iOS 26.5)での検証が完了しました。** ビルド・起動からペアリング、リモート操作、デバイス失効まで一通り動作しています。**Android版の検証で見つかった暗号処理の修正はiOSでもそのまま有効**で、iOS固有の暗号バグは見つかりませんでした。

**残る未検証項目は物理iPhone実機でのみ確認できる3点**です(QRスキャン、ローカルネットワーク権限ダイアログ、同一Wi-Fi経由の接続)。詳細は「未検証で残っている項目」を参照。

## 現在の状態(要約)

- `mobile/`のコードはiOS/Android共通のまま。今回追加したプラットフォーム分岐は表示文言と余白のみで、通信・暗号処理は完全に共通のコードがiOSでも動いている。
- PC側(`src/main/remoteServer.ts`)は無変更。**ただしPC側アプリ本体はmacOSでは起動できない**(下記)。
- iOSのネイティブプロジェクト(`mobile/ios/`)は`expo prebuild`で生成する。`mobile/.gitignore`の`/ios`で除外済みのためコミット対象外。

### 検証済みの項目(2026-08-18 / iPhone 17 Pro シミュレータ, iOS 26.5, Apple Silicon Mac)

| 項目 | 結果 |
| --- | --- |
| `npx expo run:ios` でのビルド・インストール・起動 | ✅ |
| JSバンドル(728モジュール) | ✅ 起動時クラッシュなし |
| ペアリング(6桁コード手入力→PC承認→デバイス登録) | ✅ |
| AES-256-GCMの相互運用(送信・受信の両方向) | ✅ **Android用の修正がそのまま有効。iOS固有の修正は不要だった** |
| 日本語を含む定型文のバイト一致 | ✅ 文字化けなし |
| `listItems`(ピン留め項目の取得) | ✅ |
| 定型文タップ→PC側へテキスト送信 | ✅ |
| マクロ長押し→PC側で実行+完了応答 | ✅ |
| Keychain(`expo-secure-store`)への認証情報保存 | ✅ |
| 保存済み認証情報での自動再接続(counter永続化) | ✅ アプリ再起動後、counter=1001から再開して`authOk` |
| デバイス失効→即時切断→再認証時に`authFailed`→認証情報破棄 | ✅ ペアリング画面に戻り日本語のエラーを表示 |
| カメラ権限ダイアログ | ✅ `app.json`の`NSCameraUsageDescription`がそのまま表示される |

### 未検証で残っている項目(いずれも物理実機が必要)

1. **`expo-camera`のQRスキャン**。シミュレータにカメラが無いため未検証(Android版もエミュレータの仮想カメラの都合で同じく未検証のまま)。権限を許可すると`FigCaptureSourceSimulator signalled err=-12784`等のログが出るが**クラッシュはせず**、カメラ領域が空欄になるだけ。手入力モードで代替できるためブロッカーではない。
2. **ローカルネットワーク権限ダイアログ**。iOS 14以降、LAN内のIPアドレスへの直接TCP接続には利用者の許可が必要。今回`NSLocalNetworkUsageDescription`を`app.json`に追加したが、**シミュレータではこの権限が強制されない**(ホストMacのネットワークをそのまま使うため)ので、ダイアログが正しく出るかは実機でしか確認できない。**実機で最初に確認すべき項目**。
3. **同一Wi-Fi(LAN)経由の接続**。今回は`127.0.0.1`経由でのみ検証した。2と同時に確認できる。

## Macでの事前セットアップ(2026-08-18に実際に踏んだ手順)

1. **Xcode**をApp Storeからインストールし、初回起動を済ませる。その後、以下は`sudo`が必要:
   ```bash
   sudo xcodebuild -license accept
   sudo xcodebuild -runFirstLaunch
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   ```
   > `xcode-select -s`は`xcode-select -p`が既にXcodeを指していても実行しておくこと。Xcode.appが存在すれば`-p`は自動的にXcodeを返すが、明示的な選択(`/var/db/xcode_select_link`)が無いとツールによっては「未選択」と判定される。
2. **iOSシミュレータのランタイムを別途取得する**。Xcode 26には同梱されていない。`xcodebuild -showsdks`にiOS Simulator SDKが出ていても、ランタイムが無いと`xcodebuild`は「有効なdestinationが無い」と即エラーになりコンパイルすら始まらない。
   ```bash
   xcodebuild -downloadPlatform iOS   # 8.52GB / 環境によっては30分以上
   ```
3. **Node 20.19.4以上**。Expo 57の要求は`^20.19.4 || ^22.13.0 || ^24.3.0 || >= 25.0.0`。
   ```bash
   brew install node@22 && brew unlink node && brew link --overwrite --force node@22
   ```
4. **CocoaPods**。`brew install cocoapods`(`sudo gem install`は不要)。
5. `npm install`(リポジトリルート)と`cd mobile && npm install`。

### `pod install`が必ず失敗する場合(ハマりポイント)

`LANG`が未設定のシェルでは、CocoaPodsが以下で必ず落ちる:

```
/opt/homebrew/.../unicode_normalize/normalize.rb:153:in 'UnicodeNormalize.normalize':
Unicode Normalization not appropriate for ASCII-8BIT (Encoding::CompatibilityError)
```

`expo prebuild` / `expo run:ios`はCocoaPodsを内部で呼ぶため、これらのコマンドごと失敗する。UTF-8を明示して回避する:

```bash
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios
```

恒久対応するなら`~/.zshrc`に`export LANG=en_US.UTF-8`を入れておく。

## 動作確認の手順

### 1. PC側(Ditto Remoteサーバー)を用意する

**PC側アプリ本体はmacOSでは起動できない。** `src/main/win32.ts`がトップレベルで`koffi.load('user32.dll')`を呼んでおり、`grep process.platform src/`が0件、つまりプラットフォーム分岐が一切ないため。Macだけで検証する場合は、同梱のモックサーバーを使う:

```bash
node scripts/simulate-remote-server.mjs
```

`remoteServer.ts` / `remoteCrypto.ts` / `rateLimiter.ts`のプロトコル部分をElectron非依存で再実装したもので、ペアリング承認はターミナルの`y`/`n`入力、定型文入力・マクロ再生は標準出力へのログ表示に置き換えてある。ペアリングコードはQRコードとしてターミナルに表示されるので、実機でのQRスキャン検証にも使える。対話コマンドは`code` / `list` / `revoke <番号>` / `items` / `fail` / `busy` / `quit`。

> **モックサーバーで確認できないこと**: 本物のPC側実装との相互運用そのもの。プロトコル互換の範囲での検証用と割り切ること。Windows機が使えるなら、そちらで実際のDittoを起動して`ws://<PCのIP>:58211/ws`に繋ぐほうが忠実。

### 2. iOSアプリをビルドして起動する

```bash
cd mobile
LANG=en_US.UTF-8 npx expo run:ios --device <シミュレータのUDID>
```

UDIDは`xcrun simctl list devices available`で確認できる。

> **`app.json`を変更したときは`expo prebuild`を明示的に実行すること。** `ios/`が既に存在すると`expo run:ios`はprebuildをスキップするため、`infoPlist`への追記が`ios/DittoRemote/Info.plist`に反映されない。実際に`NSLocalNetworkUsageDescription`を追加した際、`run:ios`を回しただけでは反映されず気付くのが遅れた。

### 3. ペアリング〜動作確認

1. アプリの「直接接続」タブ(Androidでは「USB接続」)を選び、モックサーバーが表示した6桁コードを入力して「連携する」。**iOSシミュレータはMacのネットワークスタックをそのまま使うため、`127.0.0.1`でMac上のサーバーに到達できる**(Androidの`adb reverse`にあたる操作は不要)。
2. モックサーバーのターミナルに承認プロンプトが出るので`y`を入力する。
3. ホーム画面に切り替わり、ダミーの定型文3件・マクロ2件がグリッド表示されることを確認する。
4. 定型文をタップ→モックサーバー側に「PC側に入力されるテキスト」としてそのまま出力されることを確認する(日本語の文字化けが無いこと)。
5. マクロを長押し→モックサーバー側に実行ログが出て、アプリへ結果が返ることを確認する。
6. アプリを再起動→ペアリング画面を経由せずホーム画面に復帰し、サーバー側ログに`auth 受信 (counter=...)`が出ることを確認する。
7. サーバー側で`revoke 1`→アプリを再起動→ペアリング画面に戻り「PC側で連携が解除されました」と表示されることを確認する。

## iOS固有で必要だった修正(すべて対応済み)

暗号処理・通信まわりの修正は**不要だった**。必要だったのは設定と表示に関するものだけ。

1. **`ios.bundleIdentifier`が未設定だった**。放置すると`expo prebuild`がExpoのプレースホルダを生成する(Androidが`com.anonymous.dittoremote`になっていたのと同じ)。Androidに合わせて`com.ditto.remote`を指定した。
2. **`NSLocalNetworkUsageDescription`が無かった**。iOS 14以降、LAN内のIPアドレスへ直接TCP接続する場合にも必要。ATS自体は`NSAllowsArbitraryLoads: false` / `NSAllowsLocalNetworking: true`(Expoの既定)で平文`ws://`が通る設定になっているため、**足りなかったのはこの権限だけ**。
3. **端末名の初期値が「Androidスマホ」固定だった**。PC側のペアリング済み一覧にそのまま出るため、`Platform.OS`で`iPhone`に切り替えるようにした。placeholderの「例: 自分のPixel」も機種非依存の文言に変更。
4. **「USB接続」タブがiOSでは成立しない**。iOSに`adb reverse`相当のトンネルは無く、実機では使えない。ラベルを「直接接続」に、説明文を「シミュレータ専用。実機では手入力タブでPCのIPを指定する」に差し替えた。
5. **上端の余白が二重取りだった**。`App.tsx`の`SafeAreaView`がiOSではセーフエリア分(Dynamic Islandで約59pt)を空けるのに、各画面が`paddingTop: 60`を重ねていた。iOSのみ12ptにした(Androidは`SafeAreaView`が実質no-opのため60ptのまま)。
6. **Keychainの既定値ではセッション鍵が別端末へ移行しうる**。`expo-secure-store`の`keychainAccessible`既定は`WHEN_UNLOCKED`で、バックアップ復元時に新しい端末へ移行される。セッション鍵はDitto Remoteの唯一の秘密であり、移行先の端末がPC側から見て意図せず有効な端末になってしまうため`WHEN_UNLOCKED_THIS_DEVICE_ONLY`に変更した(Androidでは無視されるオプションなので既存動作に影響しない)。

## 既知の未対応事項

- **切断中にボタンを押しても無反応**(Android版と同じ。iOSでも同様に再現することを確認した)。デバイス失効の直後、アプリはホーム画面のまま「未接続」表示で項目も残り、タップしてもエラーすら出ない。`wsClient.ts`の`sendRaw()`が`this.ws?.send()`で、切断済み(`ws === null`)だと何も起きないため。自動再接続の仕組みも無いので、復帰にはアプリの再起動が必要。**実用上いちばん気になる箇所で、iOS/Android共通の課題**。
- `SafeAreaView`(react-native)は非推奨で、起動時に`SafeAreaView has been deprecated and will be removed in a future release. Please use 'react-native-safe-area-context' instead.`という警告が出る。将来的には`react-native-safe-area-context`へ移行が必要(新規依存の追加になるため今回は見送り、余白の調整で対処した)。
- `expo-doctor`が`expo`パッケージの`57.0.13`と期待値`57.0.14`のパッチ差を指摘する。動作に影響は出ていない。

## 配布方法

シミュレータでの検証はApple Developer Program登録($99/年)なしで行える(今回もそうした)。実機で試す場合は、個人利用の範囲ならXcodeから直接実機ビルド(無料枠、7日間有効)で足りる。継続的に使うならApple Developer Program登録+TestFlightまたはEAS Build/EAS Submitの利用を検討する(ストア公開は将来的な話でここでは扱わない)。

## 参照ファイル

- PC側サーバー本体: `src/main/remoteServer.ts`
- PC側暗号処理: `src/main/remoteCrypto.ts`
- 共有プロトコル定義(PC側): `src/shared/types.ts`
- **PC側モックサーバー(macOS検証用)**: `scripts/simulate-remote-server.mjs`
- 開発用クライアントシミュレータ(スマホ無しでPC側だけ検証したい場合): `scripts/simulate-remote-client.mjs`
- モバイル側エントリポイント: `mobile/App.tsx`
- モバイル側画面: `mobile/src/screens/PairingScreen.tsx`, `mobile/src/screens/HomeScreen.tsx`
- モバイル側通信クライアント: `mobile/src/lib/wsClient.ts`
- モバイル側暗号処理: `mobile/src/lib/crypto.ts`
- モバイル側プロトコル定義(手動同期): `mobile/src/lib/protocol.ts`
- モバイル側認証情報の永続化: `mobile/src/lib/secureStorage.ts`
- Android側の検証結果: `mobile/ANDROID_HANDOFF.md`

## 次にやるとよいこと

1. **物理iPhone実機で、ローカルネットワーク権限ダイアログとQRスキャンを確認する**(残っている未検証項目)。同一Wi-Fi経由の接続も同時に確認できる。
2. **切断中の挙動を改善する**(上記「既知の未対応事項」)。自動再接続、または少なくとも「切断中です」というフィードバックを出す。iOS/Android共通の課題。
3. Windows機が使える状態になったら、本物のPC側Dittoに対してiOSアプリを繋ぎ、モックサーバーでは確認できない相互運用を最終確認する。
