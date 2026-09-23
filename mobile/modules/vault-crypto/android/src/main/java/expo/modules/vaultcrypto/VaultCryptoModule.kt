package expo.modules.vaultcrypto

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class VaultCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VaultCrypto")

    /**
     * PBKDF2-HMAC-SHA256 over raw bytes (base64 in and out). Hand-rolled on top of Mac rather than
     * SecretKeyFactory so the password bytes are exactly the UTF-8 the JS side produced — some
     * Android providers only take the low 8 bits of each char. Runs off the JS thread; 600k
     * iterations take well under a second natively versus tens of seconds in Hermes.
     */
    AsyncFunction("pbkdf2Sha256") { passwordB64: String, saltB64: String, iterations: Int, keyLength: Int ->
      val password = Base64.decode(passwordB64, Base64.NO_WRAP)
      val salt = Base64.decode(saltB64, Base64.NO_WRAP)
      val mac = Mac.getInstance("HmacSHA256")
      mac.init(SecretKeySpec(password, "HmacSHA256"))

      val hLen = mac.macLength
      val blocks = (keyLength + hLen - 1) / hLen
      val out = ByteArray(blocks * hLen)
      for (block in 1..blocks) {
        mac.update(salt)
        mac.update(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
        var u = mac.doFinal()
        val t = u.copyOf()
        for (i in 2..iterations) {
          u = mac.doFinal(u)
          for (j in t.indices) t[j] = (t[j].toInt() xor u[j].toInt()).toByte()
        }
        System.arraycopy(t, 0, out, (block - 1) * hLen, hLen)
      }
      Base64.encodeToString(out.copyOf(keyLength), Base64.NO_WRAP)
    }
  }
}
