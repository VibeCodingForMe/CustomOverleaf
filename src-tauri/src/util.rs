use sha2::{Digest, Sha256};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn truncate_chars(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        value.to_string()
    } else {
        value.chars().take(max).collect::<String>() + "…"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_are_stable() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(sha256_hex(b"").len(), 64);
        assert_eq!(sha256_hex(b"a"), sha256_hex(b"a"));
        assert_ne!(sha256_hex(b"a"), sha256_hex(b"b"));
    }

    #[test]
    fn truncates_on_char_boundaries() {
        assert_eq!(truncate_chars("привет", 3), "при…");
        assert_eq!(truncate_chars("ok", 3), "ok");
    }
}
