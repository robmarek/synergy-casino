use compiler::{analyze, parse, ArtifactBundle, CodeGenerator};
use std::fs;

const SOURCE: &str = include_str!("SynergyCasinoDice.synq");

fn compile() -> ArtifactBundle {
    let (_, ast) = parse(SOURCE).expect("parse SynergyCasinoDice");
    analyze(&ast).expect("analyze SynergyCasinoDice");
    let code = CodeGenerator::new()
        .generate_stateful(&ast)
        .expect("generate stateful SynQ IR");
    ArtifactBundle::generate(SOURCE, &ast, code).expect("generate SynergyCasinoDice artifacts")
}

fn main() -> std::io::Result<()> {
    let bundle = compile();
    fs::create_dir_all("artifacts")?;
    fs::write(
        "artifacts/SynergyCasinoDice.compiled.synq",
        &bundle.bytecode,
    )?;
    fs::write(
        "artifacts/SynergyCasinoDice.abi.json",
        bundle.abi_json().expect("serialize ABI"),
    )?;
    fs::write(
        "artifacts/SynergyCasinoDice.manifest.json",
        bundle.manifest_json().expect("serialize manifest"),
    )?;
    println!("SynQ stateful IR v2 · Synergy Testnet v3 · chain 1266");
    println!("Bytecode SHA-256 {}", bundle.hashes.bytecode_hash);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aivm_core::execution::{ExecutionRequest, ExecutionStatus};
    use aivm_core::state::ContractState;
    use aivm_core::stateful_synq::SynQValue;
    use aivm_core::synq_runtime::{call_synq_contract, deploy_synq_contract, SynQRuntimeReceipt};

    struct Fixture {
        request: ExecutionRequest,
        selector: Vec<u8>,
        state: ContractState,
    }

    impl Fixture {
        fn new() -> Self {
            let bundle = compile();
            let mut request =
                ExecutionRequest::synq("casino-dice-local", bundle.bytecode.clone(), 1_000_000);
            request.artifact.abi_json =
                Some(String::from_utf8(bundle.abi_json().unwrap()).unwrap());
            request.artifact.manifest_json =
                Some(String::from_utf8(bundle.manifest_json().unwrap()).unwrap());
            request.context.runtime_block_height = 1;
            request.context.block_height = 1;
            request.context.caller = b"casino-dice-local-fixture".to_vec();
            request.calldata = b"[]".to_vec();

            let selector = bundle
                .abi
                .methods
                .iter()
                .find(|method| method.name == "quotePayout")
                .expect("quotePayout ABI");
            assert_eq!(selector.mutability, "view");
            let selector = selector.selector.trim_start_matches("0x");
            let selector = selector
                .as_bytes()
                .chunks_exact(2)
                .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
                .collect::<Vec<_>>();
            let mut state = ContractState::default();
            let receipt = deploy_synq_contract(&request, &mut state);
            assert_eq!(
                receipt.status,
                ExecutionStatus::Succeeded,
                "{:?}",
                receipt.error
            );
            assert!(receipt.native_transfers.is_empty());
            Self {
                request,
                selector,
                state,
            }
        }

        fn quote(&mut self, args: serde_json::Value, value_nwei: u128) -> SynQRuntimeReceipt {
            let mut request = self.request.clone();
            request.context.call_value = value_nwei;
            request.calldata = self.selector.clone();
            request.calldata.extend(serde_json::to_vec(&args).unwrap());
            let before = self.state.state_root();
            let receipt = call_synq_contract(&request, &mut self.state);
            assert!(receipt.native_transfers.is_empty());
            assert_eq!(receipt.pre_state_root, before);
            assert_eq!(receipt.post_state_root, before);
            assert_eq!(self.state.state_root(), before);
            receipt
        }

        fn payout(&mut self, args: serde_json::Value) -> u128 {
            let receipt = self.quote(args, 0);
            assert_eq!(
                receipt.status,
                ExecutionStatus::Succeeded,
                "{:?}",
                receipt.error
            );
            let result = serde_json::from_slice(&receipt.return_data).unwrap();
            let SynQValue::Uint(payout) = result else {
                panic!("Unexpected quote result {result:?}")
            };
            payout
        }
    }

    #[test]
    fn every_dice_outcome_matches_the_practice_paytable() {
        let mut fixture = Fixture::new();
        for stake in [1, 500] {
            let mut totals = [0, 0, 0];
            for first in 1..=6 {
                for second in 1..=6 {
                    let sum = first + second;
                    for (index, (bet, multiplier)) in [
                        ("low", if sum <= 6 { 2 } else { 0 }),
                        ("high", if sum >= 8 { 2 } else { 0 }),
                        ("seven", if sum == 7 { 5 } else { 0 }),
                    ]
                    .into_iter()
                    .enumerate()
                    {
                        let payout = fixture.payout(serde_json::json!([stake, bet, first, second]));
                        assert_eq!(payout, stake * multiplier, "{first}+{second} {bet}");
                        totals[index] += payout;
                    }
                }
            }
            assert_eq!(totals, [30 * stake; 3]);
        }
    }

    #[test]
    fn invalid_quotes_revert_atomically() {
        let mut fixture = Fixture::new();
        for (args, reason) in [
            (serde_json::json!([0, "low", 1, 1]), "Stake"),
            (serde_json::json!([501, "low", 1, 1]), "Stake"),
            (serde_json::json!([10, "low", 0, 1]), "First die"),
            (serde_json::json!([10, "high", 7, 1]), "First die"),
            (serde_json::json!([10, "low", 1, 0]), "Second die"),
            (serde_json::json!([10, "high", 1, 7]), "Second die"),
            (serde_json::json!([10, "odd", 2, 1]), "Unknown dice bet"),
        ] {
            let receipt = fixture.quote(args, 0);
            assert_eq!(receipt.status, ExecutionStatus::Reverted);
            assert!(receipt.error.unwrap_or_default().contains(reason));
        }
    }

    #[test]
    fn rejects_native_value_on_setup_and_quotes() {
        let mut fixture = Fixture::new();
        let mut request = fixture.request.clone();
        request.context.call_value = 1_000_000_000;
        let mut blank = ContractState::default();
        let receipt = deploy_synq_contract(&request, &mut blank);
        assert_eq!(receipt.status, ExecutionStatus::Reverted);
        assert!(receipt
            .error
            .unwrap_or_default()
            .contains("Practice SNRG only"));
        assert_eq!(blank, ContractState::default());
        assert!(receipt.native_transfers.is_empty());

        let receipt = fixture.quote(
            serde_json::json!([10, "seven", 3, 4]),
            request.context.call_value,
        );
        assert_eq!(receipt.status, ExecutionStatus::Reverted);
        assert!(receipt
            .error
            .unwrap_or_default()
            .contains("Practice SNRG only"));
    }
}
