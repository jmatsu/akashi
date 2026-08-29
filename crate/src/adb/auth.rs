//! The half of the ADB handshake that proves who is calling.
//!
//! A daemon that has not been told to trust us answers our connection with a
//! 20-byte token. We sign it with the same RSA key `adb` itself uses --
//! `~/.android/adbkey` -- so a device that already trusts this workstation
//! over USB trusts this binary too, with nothing to authorise a second time.
//!
//! A device that has never seen the key wants the key itself, in the packed
//! little-endian form Android's own verifier reads, and shows the *Allow USB
//! debugging?* dialog with its fingerprint. That is the one step of this
//! experiment a human has to be holding the phone for.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use rsa::pkcs1::DecodeRsaPrivateKey;
use rsa::pkcs8::DecodePrivateKey;
use rsa::traits::PublicKeyParts;
use rsa::{BigUint, Pkcs1v15Sign, RsaPrivateKey};

/// The DER prelude of a PKCS#1 v1.5 signature over a SHA-1 digest. An auth
/// token arrives as a digest already -- 20 bytes of the daemon's randomness --
/// so this is prepended rather than anything being hashed.
const SHA1_DIGEST_INFO: [u8; 15] =
    [0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14];

/// Android's public key blob is a fixed 2048-bit layout; there is no field
/// that could describe another size.
const MODULUS_BYTES: usize = 256;
const MODULUS_WORDS: u32 = (MODULUS_BYTES / 4) as u32;

pub struct Key {
    private: RsaPrivateKey,
}

impl Key {
    /// Where `adb` keeps the key it generated for this workstation.
    pub fn default_path() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|home| Path::new(&home).join(".android").join("adbkey"))
    }

    /// Reads a private key file, putting its path into whatever goes wrong --
    /// an error about a key says little without saying which key.
    pub fn load(path: &Path) -> io::Result<Self> {
        let named = |error: io::Error| io::Error::new(error.kind(), format!("{}: {error}", path.display()));
        let pem = fs::read_to_string(path).map_err(named)?;
        Self::from_pem(&pem).map_err(named)
    }

    /// Accepts either PEM the toolchain has written: modern `adb` writes
    /// PKCS#8, older releases wrote PKCS#1.
    pub fn from_pem(pem: &str) -> io::Result<Self> {
        let private = RsaPrivateKey::from_pkcs8_pem(pem)
            .or_else(|_| RsaPrivateKey::from_pkcs1_pem(pem))
            .map_err(|error| {
                io::Error::new(io::ErrorKind::InvalidData, format!("not an RSA private key: {error}"))
            })?;
        if private.size() != MODULUS_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("ADB keys are 2048-bit; this one is {}-bit", private.size() * 8),
            ));
        }
        Ok(Self { private })
    }

    /// Signs the daemon's challenge. The token is the digest, not the message.
    pub fn sign(&self, token: &[u8]) -> io::Result<Vec<u8>> {
        let mut digest_info = SHA1_DIGEST_INFO.to_vec();
        digest_info.extend_from_slice(token);
        self.private
            .sign(Pkcs1v15Sign::new_unprefixed(), &digest_info)
            .map_err(|error| io::Error::other(format!("signing the auth token failed: {error}")))
    }

    /// The key as the device wants to be given it: base64 of the packed blob,
    /// then a space and a name for the dialog, then the NUL that ends it.
    pub fn public_key_payload(&self, name: &str) -> Vec<u8> {
        let mut payload = base64(&self.public_key_blob()).into_bytes();
        payload.push(b' ');
        payload.extend_from_slice(name.as_bytes());
        payload.push(0);
        payload
    }

    /// Android's `RSAPublicKey`: the modulus word count, `-1/n mod 2^32`, the
    /// modulus and `R^2 mod n` as little-endian bytes, and the exponent. The
    /// two derived values are there because the device verifies with Montgomery
    /// arithmetic and will not compute them itself.
    fn public_key_blob(&self) -> Vec<u8> {
        let modulus = self.private.n();
        let mut blob = Vec::with_capacity(4 + 4 + MODULUS_BYTES * 2 + 4);
        blob.extend_from_slice(&MODULUS_WORDS.to_le_bytes());
        blob.extend_from_slice(&n0inv(modulus).to_le_bytes());
        blob.extend_from_slice(&little_endian(modulus));
        blob.extend_from_slice(&little_endian(&r_squared(modulus)));
        blob.extend_from_slice(&exponent(self.private.e()).to_le_bytes());
        blob
    }
}

/// `R^2 mod n`, where `R` is `2^2048` -- the residue the device multiplies by
/// to enter Montgomery form.
fn r_squared(modulus: &BigUint) -> BigUint {
    BigUint::from(2u32).modpow(&BigUint::from(MODULUS_BYTES as u32 * 16), modulus)
}

/// `-1/n mod 2^32`, by Newton's iteration: each round doubles the number of
/// correct bits, so five take one bit to thirty-two.
fn n0inv(modulus: &BigUint) -> u32 {
    let low = u32::from_le_bytes(little_endian(modulus)[..4].try_into().expect("256 bytes"));
    let mut inverse = 1u32;
    for _ in 0..5 {
        inverse = inverse.wrapping_mul(2u32.wrapping_sub(low.wrapping_mul(inverse)));
    }
    inverse.wrapping_neg()
}

/// A 2048-bit value as the device reads it: 256 little-endian bytes.
fn little_endian(value: &BigUint) -> [u8; MODULUS_BYTES] {
    let mut bytes = [0u8; MODULUS_BYTES];
    let value = value.to_bytes_le();
    bytes[..value.len()].copy_from_slice(&value);
    bytes
}

/// The blob has one word for the exponent, and `adb` only ever writes 65537.
fn exponent(exponent: &BigUint) -> u32 {
    let mut word = [0u8; 4];
    let bytes = exponent.to_bytes_le();
    let taken = bytes.len().min(4);
    word[..taken].copy_from_slice(&bytes[..taken]);
    u32::from_le_bytes(word)
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let mut word = 0u32;
        for (index, byte) in chunk.iter().enumerate() {
            word |= u32::from(*byte) << (16 - index * 8);
        }
        for index in 0..4 {
            out.push(if index <= chunk.len() {
                char::from(ALPHABET[(word >> (18 - index * 6)) as usize & 0x3f])
            } else {
                '='
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A key generated for these tests and nothing else -- it authorises no
    /// device and guards nothing. Checked in so the tests neither generate a
    /// 2048-bit key on every run nor reach for the developer's own.
    const PKCS8: &str = include_str!("testdata/adbkey-pkcs8.pem");
    const PKCS1: &str = include_str!("testdata/adbkey-pkcs1.pem");

    fn key() -> Key {
        Key::from_pem(PKCS8).expect("the test key")
    }

    #[test]
    fn either_pem_the_toolchain_has_written_loads() {
        for pem in [PKCS8, PKCS1] {
            let loaded = Key::from_pem(pem).expect("adb has written both of these");
            assert_eq!(loaded.public_key_blob(), key().public_key_blob());
        }
    }

    #[test]
    fn something_that_is_not_a_key_is_refused_rather_than_panicking() {
        let pem = "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----\n";
        assert!(Key::from_pem(pem).is_err());
    }

    #[test]
    fn a_missing_key_file_names_the_path_it_looked_at() {
        let error = Key::load(Path::new("/nowhere/adbkey")).err().expect("there is no such file");
        assert!(error.to_string().contains("/nowhere/adbkey"));
    }

    #[test]
    fn base64_matches_the_encoding_the_device_decodes() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xef, 0xbe]), "/+++");
    }

    #[test]
    fn the_public_key_blob_is_the_layout_androids_verifier_reads() {
        let key = key();
        let blob = key.public_key_blob();
        assert_eq!(blob.len(), 4 + 4 + MODULUS_BYTES * 2 + 4);
        assert_eq!(u32::from_le_bytes(blob[..4].try_into().unwrap()), MODULUS_WORDS);
        assert_eq!(u32::from_le_bytes(blob[blob.len() - 4..].try_into().unwrap()), 65537);
        assert_eq!(blob[8..8 + MODULUS_BYTES], little_endian(key.private.n()));
    }

    #[test]
    fn n0inv_is_the_negated_inverse_of_the_lowest_modulus_word() {
        let key = key();
        let modulus = key.private.n();
        let low = u32::from_le_bytes(little_endian(modulus)[..4].try_into().unwrap());
        assert_eq!(low.wrapping_mul(n0inv(modulus)), u32::MAX);
    }

    #[test]
    fn r_squared_is_two_to_the_double_modulus_width() {
        let key = key();
        let modulus = key.private.n();
        let expected = (BigUint::from(1u32) << 4096) % modulus;
        assert_eq!(r_squared(modulus), expected);
    }

    #[test]
    fn a_signed_token_verifies_under_the_public_key() {
        let key = key();
        let token = [0x5au8; 20];
        let signature = key.sign(&token).expect("signing a 20-byte token");
        let mut digest_info = SHA1_DIGEST_INFO.to_vec();
        digest_info.extend_from_slice(&token);
        key.private
            .to_public_key()
            .verify(Pkcs1v15Sign::new_unprefixed(), &digest_info, &signature)
            .expect("the daemon runs this same check");
    }

    #[test]
    fn the_public_key_payload_is_named_and_nul_terminated() {
        let payload = key().public_key_payload("akashi@example");
        assert_eq!(payload.last(), Some(&0));
        let text = String::from_utf8(payload[..payload.len() - 1].to_vec()).unwrap();
        let (encoded, name) = text.split_once(' ').expect("a name follows the key");
        assert_eq!(name, "akashi@example");
        assert!(encoded.chars().all(|c| c.is_ascii_alphanumeric() || "+/=".contains(c)));
    }
}
