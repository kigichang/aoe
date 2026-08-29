// Windows release 版不要開主控台視窗
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aoe_app_lib::run()
}
