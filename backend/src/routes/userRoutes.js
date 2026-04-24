import express from "express";
import {
    listUsers, createUser, updateUser, deleteUser, setDefaultView,
    getUserGroups,
    listGroups, createGroup, updateGroup, deleteGroup, getGroupMembers, updateGroupMembers, getGroupSheets,
    addUserToGroup, removeUserFromGroup, toggleGroupAdmin,
    listFolders, createFolder, deleteFolder,
    setPermissions, getPermissions, setGroupPermissions, getGroupPermissions
} from "../controllers/userController.js";
import { auth } from "../middleware/auth.js";

const router = express.Router();
router.use(auth);

// Users
router.get("/users", listUsers);
router.get("/users/:id/groups", getUserGroups);
router.post("/users", createUser);
router.patch("/users/:id", updateUser);
router.delete("/users/:id", deleteUser);
router.put("/users/:userId/default-view", setDefaultView);

// Groups
router.use("/groups", (req, res, next) => {
    console.log(`[debug] Group request: ${req.method} ${req.url}`);
    next();
});
router.post("/groups/:id/users/:userId/admin", toggleGroupAdmin);
router.get("/groups", listGroups);
router.post("/groups", createGroup);
router.patch("/groups/:id", updateGroup);
router.delete("/groups/:id", deleteGroup);
router.get("/groups/:id/members", getGroupMembers);
router.post("/groups/:id/members", updateGroupMembers);
router.get("/groups/:id/users", getGroupMembers); // Alias for frontend compatibility
router.post("/groups/:id/users", addUserToGroup);
router.delete("/groups/:id/users/:userId", removeUserFromGroup);
router.get("/groups/:id/sheets", getGroupSheets);

// Folders
router.get("/folders", listFolders);
router.post("/folders", createFolder);
router.delete("/folders/:id", deleteFolder);

// Permissions
router.post("/permissions", setPermissions); // User perms
router.get("/permissions", getPermissions);
router.post("/group-permissions", setGroupPermissions);
router.get("/group-permissions", getGroupPermissions);

export default router;
