# Ditto Remote — iOS対応 引き継ぎメモ

このファイルは、**Mac環境**が用意でき次第iOS対応を引き継ぐための資料です。現時点でiOS版の実装・動作確認は一切行っていません(開発機がWindowsだったため、方針としてまずAndroidのみで進めることをユーザーが決定済み)。

## 現在の状態(要約)

- `mobile/`のExpo(React Native, TypeScript)プロジェクトはAndroidを主眼に実装されているが、**コード自体はiOS/Android共通**(React Nativeのプラットフォーム分岐は書いていない)。理屈上はiOSでもそのまま動く設計だが、iOS実機/シミュレータでの起動・動作は一度も試していない。
- `app.json`にiOS向けの最低限の設定(`supportsTablet`、カメラ権限の説明文`NSCameraUsageDescription`)は入れてあるが、それ以外のiOS固有設定(署名、Bundle Identifier等)は未着手。
- PC側(`src/main/remoteServer.ts`)はプラットフォームを区別しない設計(WebSocket+AES-256-GCM暗号化)のため、PC側の変更は不要なはず。

## Macでの事前セットアップ

1. **Xcode**(App Storeからインストール)+ Command Line Tools。
2. このリポジトリを取得(clone、または既存クローンをpull)。
3. `cd mobile && npm install`。
4. (実機で試す場合)Apple Developer Program登録($99/年)が実質必須。シミュレータのみなら不要。

## 動作確認の手順(想定。未検証)

```bash
cd mobile
npx expo run:ios
```

初回は`npx expo prebuild`相当の処理でiOSネイティブプロジェクトが生成される。シミュレータかMacに繋いだ実機を選んで起動する。

PC側との連携確認手順はAndroid版(`mobile/ANDROID_HANDOFF.md`)と同じ(QRペアリング→PC側承認ダイアログ→定型文/マクロのリモートトリガー→デバイス失効)。**Android版の検証が先に完了していれば、そちらで見つかった問題(expo-cryptoのAPI不一致など)は同じ`src/`コードを共有しているためiOS側にも影響する**。まずAndroid側の`ANDROID_HANDOFF.md`が「検証完了」になっているか確認してから着手するとよい。

## iOS特有で確認・対応が必要になりそうな点

- **カメラ権限**: `app.json`の`ios.infoPlist.NSCameraUsageDescription`は設定済み。実機で権限ダイアログが正しく出るか確認する。
- **`expo-secure-store`の挙動**: AndroidはKeystore、iOSはKeychainを裏で使う。API自体は共通だが、実機でのキーチェーンアクセス許可まわりで挙動差が出ないか確認する。
- **`expo-crypto`のAES-GCM API**: **Android側の検証(2026-08-17完了)で、型定義と実装が食い違うバグが2件見つかっている**(`ciphertext()`が`encoding: 'base64'`を無視してUint8Arrayを返す / `fromParts()`がbase64文字列のtagを受け付けない)。詳細と対処は`ANDROID_HANDOFF.md`の「検証で見つかったバグ」を参照。現在の`mobile/src/lib/crypto.ts`は戻り値がstringでもUint8Arrayでも動くよう正規化してあるため、iOSでもそのまま動く見込みが高い。ただし**これらはAndroidのKotlin実装に起因する問題なので、iOS(CryptoKit経由)では別の挙動をする可能性がある**。`tsc`は通ってしまうため、疑わしい場合は固定の鍵・IV・平文でNode側(`src/main/remoteCrypto.ts`)と出力を突き合わせること。
- **配布方法**: 個人利用の範囲であれば、Xcodeから直接実機ビルド(7日間有効の無料枠)で足りる。継続的に使うならApple Developer Program登録+TestFlightまたはEAS Build/EAS Submitの利用を検討する(ストア公開は将来的な話でここでは扱わない)。
- **Windows機での継続開発との連携**: iOSのネイティブプロジェクト生成物(`ios/`ディレクトリ、もし`expo prebuild`で作られた場合)はWindows側に持ち帰っても使えないため、`.gitignore`に含めるかコミット対象から外すか判断すること(現状`mobile/.gitignore`はExpoの標準テンプレートのものをそのまま使っている)。

## 参照ファイル

Android版の`ANDROID_HANDOFF.md`と同じファイル群を参照(PC側・Android側は共通コードのため)。特に:

- 共有プロトコル定義(PC側): `src/shared/types.ts`
- Android側で検証済みのはずの暗号処理: `mobile/src/lib/crypto.ts`(iOSでも同じファイルを使う)
- Android側で検証済みのはずの通信クライアント: `mobile/src/lib/wsClient.ts`(同上)

## 完了したらやること

検証結果(成功/失敗、iOS固有で必要だった修正)をこのファイルに追記し、コミット・pushしておく。
