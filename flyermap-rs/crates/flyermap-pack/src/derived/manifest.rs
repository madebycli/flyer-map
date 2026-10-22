//! A big Gebiet is many parts (the grid cells of `plan`), each its own pack. The manifest lists them and names the whole: one small file a
//! device fetches first, then only the parts it does not hold. Its total hash is made of what the parts *are* (index, cell, content), so it
//! changes exactly when a part's content or the part list changes, and does not depend on how the parts were compressed.
use super::{error::DerivedError, hash, header::FORMAT, pack::DerivedPack};
use crate::plan::{Cell, PackPart};
use serde::{Deserialize, Serialize};

pub const MANIFEST_PREFIX: &str = "m/";

/// One part as the manifest knows it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PartRef {
    pub index: usize,
    /// `None` for a Gebiet that is one part.
    pub cell: Option<Cell>,
    /// The part's pack name (32 hex characters).
    pub hash: String,
    /// Stored size of the pack in bytes (what a device is about to download); not part of the total hash.
    pub size: u64,
    pub houses: u32,
}

impl PartRef {
    pub fn of(part: &PackPart, pack: &DerivedPack) -> PartRef {
        PartRef { index: part.index, cell: part.cell, hash: pack.hash.clone(), size: pack.bytes.len() as u64, houses: pack.header.counts.houses }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub format: u16,
    pub engine_version: String,
    /// In plan order (by index).
    pub parts: Vec<PartRef>,
    /// 32 hex characters over the engine version and the parts' index, cell and pack name.
    pub hash: String,
}

fn total(engine_version: &str, parts: &[PartRef]) -> String {
    let mut data: Vec<u8> = Vec::with_capacity(32 + parts.len() * 80);
    data.extend_from_slice(b"FM6M");
    data.extend_from_slice(&FORMAT.to_le_bytes());
    data.extend_from_slice(&(engine_version.len() as u32).to_le_bytes());
    data.extend_from_slice(engine_version.as_bytes());
    data.extend_from_slice(&(parts.len() as u32).to_le_bytes());
    for part in parts {
        data.extend_from_slice(&(part.index as u64).to_le_bytes());
        match part.cell {
            Some(cell) => {
                data.push(1);
                cell.iter().for_each(|n| data.extend_from_slice(&n.to_bits().to_le_bytes()));
            }
            None => data.extend_from_slice(&[0; 33]),
        }
        data.extend_from_slice(&(part.hash.len() as u32).to_le_bytes());
        data.extend_from_slice(part.hash.as_bytes());
    }
    hash::hex(&hash::of(&data))
}

/// The manifest of the parts, in plan order whatever order they were derived in.
pub fn manifest(parts: &[PartRef]) -> Manifest {
    let mut parts = parts.to_vec();
    parts.sort_by_key(|p| p.index);
    let engine_version = flyermap_engine::ENGINE_VERSION.to_string();
    Manifest { format: FORMAT, hash: total(&engine_version, &parts), engine_version, parts }
}

fn same_cell(a: &Option<Cell>, b: &Option<Cell>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(x), Some(y)) => x.iter().zip(y).all(|(p, q)| p.to_bits() == q.to_bits()),
        _ => false,
    }
}

impl Manifest {
    /// `m/<hash>`.
    pub fn address(&self) -> String {
        format!("{MANIFEST_PREFIX}{}", self.hash)
    }

    pub fn to_json(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    /// A manifest from storage or the network: the format and engine are ones this build reads, the parts are in order, and the total hash is
    /// what the parts make of it.
    pub fn from_json(bytes: &[u8]) -> Result<Manifest, DerivedError> {
        let manifest: Manifest = serde_json::from_slice(bytes).map_err(|_| DerivedError::Manifest)?;
        if manifest.format > FORMAT {
            return Err(DerivedError::TooNew { found: manifest.format, supported: FORMAT });
        }
        if manifest.format == 0 {
            return Err(DerivedError::UnknownFormat(0));
        }
        if manifest.engine_version != flyermap_engine::ENGINE_VERSION {
            return Err(DerivedError::EngineVersion { found: manifest.engine_version, expected: flyermap_engine::ENGINE_VERSION.to_string() });
        }
        let ordered = manifest.parts.windows(2).all(|w| w[0].index < w[1].index);
        let named = manifest.parts.iter().all(|p| hash::parse(&p.hash).is_some());
        if !ordered || !named || total(&manifest.engine_version, &manifest.parts) != manifest.hash {
            return Err(DerivedError::Manifest);
        }
        Ok(manifest)
    }

    /// The parts of this manifest a device that holds `held` still has to fetch: those whose cell is new or whose pack name differs.
    pub fn parts_to_fetch(&self, held: &Manifest) -> Vec<usize> {
        self.parts.iter().filter(|p| !held.parts.iter().any(|h| same_cell(&h.cell, &p.cell) && h.hash == p.hash)).map(|p| p.index).collect()
    }

    /// Bytes of the parts `parts_to_fetch` names.
    pub fn bytes_to_fetch(&self, held: &Manifest) -> u64 {
        let wanted = self.parts_to_fetch(held);
        self.parts.iter().filter(|p| wanted.contains(&p.index)).map(|p| p.size).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(index: usize, seed: u8) -> PartRef {
        let name = hash::hex(&hash::of(&[seed]));
        PartRef { index, cell: Some([index as f64 * 0.03, 50.0, (index + 1) as f64 * 0.03, 50.02]), hash: name, size: 1000 + u64::from(seed), houses: 10 }
    }

    #[test]
    fn the_total_depends_on_content_and_list_not_on_arrival_order_or_size() {
        let parts = vec![part(0, 1), part(1, 2), part(2, 3)];
        let m = manifest(&parts);
        assert_eq!(m.hash.len(), 32);
        assert_eq!(manifest(&[parts[2].clone(), parts[0].clone(), parts[1].clone()]), m);
        let mut resized = parts.clone();
        resized[1].size += 5;
        assert_eq!(manifest(&resized).hash, m.hash);
        let mut changed = parts.clone();
        changed[1] = part(1, 9);
        assert_ne!(manifest(&changed).hash, m.hash);
        assert_ne!(manifest(&parts[..2]).hash, m.hash);
        assert_eq!(m.address(), format!("m/{}", m.hash));
    }

    #[test]
    fn json_round_trips_and_refuses_tampering() {
        let m = manifest(&[part(0, 1), part(1, 2)]);
        assert_eq!(Manifest::from_json(&m.to_json()), Ok(m.clone()));
        let text = String::from_utf8(m.to_json()).unwrap();
        let swapped = text.replacen(&m.parts[0].hash, &m.parts[1].hash, 1);
        assert_eq!(Manifest::from_json(swapped.as_bytes()), Err(DerivedError::Manifest));
        let newer = text.replacen("\"format\":1", "\"format\":2", 1);
        assert!(matches!(Manifest::from_json(newer.as_bytes()), Err(DerivedError::TooNew { found: 2, .. })));
        assert_eq!(Manifest::from_json(b"{}"), Err(DerivedError::Manifest));
    }

    #[test]
    fn only_changed_or_new_parts_are_fetched() {
        let old = manifest(&[part(0, 1), part(1, 2), part(2, 3)]);
        let new = manifest(&[part(0, 1), part(1, 7), part(2, 3), part(3, 4)]);
        assert_eq!(new.parts_to_fetch(&old), vec![1, 3]);
        assert_eq!(new.bytes_to_fetch(&old), 1007 + 1004);
        assert!(new.parts_to_fetch(&new).is_empty());
    }
}
