//! Räume (distribution): a Gruppe works in a Gebiet in stages. Someone opens a room and says how many people take part (devices are never counted),
//! others join with a link or QR code, and when the stage is over the room is finished. Guests get an access of their own (a team-editor grant bound
//! to the room and its Gebiet) that ends with the room.
mod join;
mod manage;
mod model;
mod password;

pub use join::{info, join};
pub use manage::{create, delete, finish, list, update};
