fn main() {
  // `tauri_build` compiles the Windows resource script, and that script names
  // `icons/icon.ico` by path — but it does not tell cargo that the build script
  // depends on it. Since it does emit other rerun-if-changed directives, cargo
  // stops watching everything else, and an icon that changes leaves the old
  // compiled resource to be linked into an otherwise freshly built binary.
  //
  // The failure is quiet and convincing: the build succeeds, the executable is
  // new, and the icon is the one from whenever the resource was last compiled.
  println!("cargo:rerun-if-changed=icons/icon.ico");
  println!("cargo:rerun-if-changed=icons");

  tauri_build::build()
}
