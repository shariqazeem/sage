//! Sage's Starknet settlement rail.

pub mod claims;
pub mod erc20;

// Test-only contracts. Not `#[cfg(test)]`: snforge's `declare()` reads the
// package's build artifacts, and a cfg-gated contract never reaches them.
pub mod mock_erc20;
pub mod mock_fee_erc20;

#[cfg(test)]
mod tests_claims;
