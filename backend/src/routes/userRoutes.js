import express from "express";
import {
    listUsers, createUser, updateUser, deleteUser, setDefaultView,
    listGroups, createGroup, deleteGroup, getGroupMembers, updateGroupMembers, getGroupSheets,
    listFolders, createFolder, deleteFolder,
    setPermissions, getPermissions, setGroupPermissions, getGroupPermissions
} from "../controllers/userController.js";
import { auth } from "../middleware/auth.js";

const router = express.Router();
router.use(auth);

// Users
router.get("/users", listUsers);
router.post("/users", createUser);
router.patch("/users/:id", updateUser);
router.delete("/users/:id", deleteUser);
router.put("/users/:userId/default-view", setDefaultView);

// Groups
router.get("/groups", listGroups);
router.post("/groups", createGroup);
router.delete("/groups/:id", deleteGroup);
router.get("/groups/:id/members", getGroupMembers);
router.post("/groups/:id/members", updateGroupMembers);
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
