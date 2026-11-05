use tauri::{menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem}, Emitter, Manager};

pub struct ProjectActionsMenu(Menu<tauri::Wry>);

pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    let new = MenuItem::with_id(app, "project-new", "New Project…", true, Some("CmdOrCtrl+N"))?;
    let open = MenuItem::with_id(app, "project-open", "Open Project…", true, Some("CmdOrCtrl+O"))?;
    let rename = MenuItem::with_id(app, "project-rename", "Rename Project…", true, None::<&str>)?;
    let save = MenuItem::with_id(app, "project-save", "Save Project", true, Some("CmdOrCtrl+S"))?;
    let sidebar = MenuItem::with_id(app, "sidebar-toggle", "Show/Hide Clip Sidebar", true, Some("CmdOrCtrl+Shift+B"))?;
    for item in menu.items()? {
        if let Some(submenu) = item.as_submenu() {
            match submenu.text()?.as_str() {
                "File" => submenu.insert_items(&[&new, &open, &rename, &save, &PredefinedMenuItem::separator(app)?], 0)?,
                "View" => submenu.insert_items(&[&sidebar, &PredefinedMenuItem::separator(app)?], 0)?,
                _ => {}
            }
        }
    }
    app.set_menu(menu)?;
    let project_actions = Menu::with_items(app, &[
        &MenuItem::with_id(app, "project-new", "New Project…", true, Some("CmdOrCtrl+N"))?,
        &MenuItem::with_id(app, "project-open", "Open Project…", true, Some("CmdOrCtrl+O"))?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "project-rename", "Rename Project…", true, None::<&str>)?,
    ])?;
    app.manage(ProjectActionsMenu(project_actions));
    app.on_menu_event(|app, event| {
        let action = match event.id().as_ref() {
            "project-new" => "new",
            "project-open" => "open",
            "project-save" => "save",
            "project-rename" => "rename",
            "sidebar-toggle" => "sidebar",
            _ => return,
        };
        let _ = app.emit("studio-menu", action);
    });
    Ok(())
}


#[tauri::command]
pub fn show_project_menu(menu: tauri::State<'_, ProjectActionsMenu>, window: tauri::Window, x: f64, y: f64) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() { return Err("Invalid menu position".into()); }
    menu.0.popup_at(window, tauri::LogicalPosition::new(x, y)).map_err(|e| e.to_string())
}
