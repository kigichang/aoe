use std::path::Path;
use std::process::Command;

fn main() {
    // 內嵌的資料 bundle。沒有的話試著用 repo 的工具產一份；還是沒有就明確報錯，
    // 不要讓 include_bytes! 給一個看不懂的訊息。
    let data = Path::new("data/data-bundle.json.gz");
    if !data.exists() {
        let _ = Command::new("node")
            .args(["--experimental-strip-types", "../../tools/bundle.mjs", "--out", "data"])
            .status();
    }
    if !data.exists() {
        panic!("缺少 data/data-bundle.json.gz：在 repo 根目錄執行 `npm run bundle -- --out app/src-tauri/data`");
    }
    println!("cargo:rerun-if-changed=data/data-bundle.json.gz");
    tauri_build::build()
}
