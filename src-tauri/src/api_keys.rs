//! Provider credentials live outside the app bundle and the user-exportable database.
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use std::{
    fs,
    io::{self, ErrorKind, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

const MASTER: &str = "master.v1";
const KEY_BYTES: usize = 32;
const STORAGE_ERROR: &str = "无法读取或保存本机 API Key，请检查应用数据目录的访问权限。";

pub struct ApiKeys(PathBuf);

pub fn store(app: &AppHandle) -> Result<ApiKeys, String> {
    app.path()
        .app_data_dir()
        .map(|dir| ApiKeys(dir.join("credentials-v1")))
        .map_err(|_| STORAGE_ERROR.to_owned())
}

fn storage_error(_: io::Error) -> String {
    STORAGE_ERROR.to_owned()
}

fn staged(dir: &Path, bytes: &[u8]) -> io::Result<NamedTempFile> {
    let mut temp = NamedTempFile::new_in(dir)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    Ok(temp)
}

impl ApiKeys {
    fn key(&self, create: bool) -> Result<aead::LessSafeKey, String> {
        let path = self.0.join(MASTER);
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(err) if create && err.kind() == ErrorKind::NotFound => {
                let mut bytes = [0; KEY_BYTES];
                SystemRandom::new()
                    .fill(&mut bytes)
                    .map_err(|_| STORAGE_ERROR)?;
                match staged(&self.0, &bytes)
                    .map_err(storage_error)?
                    .persist_noclobber(&path)
                {
                    Ok(_) => bytes.to_vec(),
                    Err(err) if err.error.kind() == ErrorKind::AlreadyExists => {
                        fs::read(path).map_err(storage_error)?
                    }
                    Err(err) => return Err(storage_error(err.error)),
                }
            }
            Err(err) => return Err(storage_error(err)),
        };
        aead::UnboundKey::new(&aead::AES_256_GCM, &bytes)
            .map(aead::LessSafeKey::new)
            .map_err(|_| STORAGE_ERROR.to_owned())
    }

    pub fn save(&self, provider: &str, value: &str) -> Result<(), String> {
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
        builder
            .recursive(true)
            .create(&self.0)
            .map_err(storage_error)?;
        let key = self.key(true)?;
        let mut nonce = [0; aead::NONCE_LEN];
        SystemRandom::new()
            .fill(&mut nonce)
            .map_err(|_| STORAGE_ERROR)?;
        let mut payload = value.as_bytes().to_vec();
        key.seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(provider.as_bytes()),
            &mut payload,
        )
        .map_err(|_| STORAGE_ERROR)?;
        let data = [nonce.as_slice(), &payload].concat();
        staged(&self.0, &data)
            .map_err(storage_error)?
            .persist(self.0.join(provider))
            .map_err(|err| storage_error(err.error))?;
        Ok(())
    }

    pub fn load(&self, provider: &str) -> Result<Option<String>, String> {
        let mut data = match fs::read(self.0.join(provider)) {
            Ok(data) => data,
            Err(err) if err.kind() == ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(storage_error(err)),
        };
        let invalid = "本机 API Key 配置已损坏，请在设置里重新保存。";
        let (nonce, payload) = data.split_at_mut_checked(aead::NONCE_LEN).ok_or(invalid)?;
        let nonce = aead::Nonce::try_assume_unique_for_key(nonce).map_err(|_| invalid)?;
        let plain = self
            .key(false)?
            .open_in_place(nonce, aead::Aad::from(provider.as_bytes()), payload)
            .map_err(|_| invalid)?;
        String::from_utf8(plain.to_vec())
            .map(Some)
            .map_err(|_| invalid.to_owned())
    }

    pub fn clear(&self, provider: &str) -> Result<(), String> {
        match fs::remove_file(self.0.join(provider)) {
            Err(err) if err.kind() == ErrorKind::NotFound => Ok(()),
            result => result.map_err(storage_error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reopened_store_reads_replaced_value_and_rejects_swapped_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let store = ApiKeys(dir.path().join("credentials-v1"));
        assert_eq!(store.load("deepseek").unwrap(), None);
        store.save("deepseek", "first").unwrap();
        store.save("deepseek", "second").unwrap();
        let reopened = ApiKeys(store.0.clone());
        assert_eq!(
            reopened.load("deepseek").unwrap().as_deref(),
            Some("second")
        );
        fs::copy(store.0.join("deepseek"), store.0.join("mimo")).unwrap();
        assert!(store.load("mimo").is_err());
        store.clear("deepseek").unwrap();
        assert_eq!(store.load("deepseek").unwrap(), None);
    }
}
