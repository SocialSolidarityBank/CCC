#pragma once
#include <napi.h>
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <string>
#include <vector>
#include <stdexcept>
#pragma comment(lib, "advapi32.lib")

namespace ccc_records {
inline void Denied() { throw std::runtime_error("secret_access_denied"); }
struct Handle {
  HANDLE value;
  explicit Handle(HANDLE h) : value(h) { if (h == INVALID_HANDLE_VALUE || h == nullptr) Denied(); }
  ~Handle() { if (value != INVALID_HANDLE_VALUE) CloseHandle(value); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
};
struct LocalMemory {
  PVOID value = nullptr;
  ~LocalMemory() { if (value) LocalFree(value); }
  LocalMemory() = default;
  LocalMemory(const LocalMemory&) = delete;
  LocalMemory& operator=(const LocalMemory&) = delete;
};
inline std::vector<BYTE> UserToken() {
  HANDLE raw = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw)) Denied();
  Handle token(raw); DWORD size = 0;
  GetTokenInformation(token.value, TokenUser, nullptr, 0, &size);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || size == 0) Denied();
  std::vector<BYTE> data(size);
  if (!GetTokenInformation(token.value, TokenUser, data.data(), size, &size)) Denied();
  return data;
}
inline std::wstring Path(const Napi::Value& value) {
  if (!value.IsString()) Denied();
  auto input = value.As<Napi::String>().Utf16Value();
  if (input.empty() || input.find(u'\0') != std::u16string::npos) Denied();
  std::wstring wide(input.begin(), input.end());
  DWORD size = GetFullPathNameW(wide.c_str(), 0, nullptr, nullptr);
  if (size == 0) Denied();
  std::vector<wchar_t> buffer(size);
  DWORD length = GetFullPathNameW(wide.c_str(), size, buffer.data(), nullptr);
  if (length == 0 || length >= size) Denied();
  return std::wstring(buffer.data(), length);
}
inline void CheckHandle(HANDLE handle, bool directory) {
  BY_HANDLE_FILE_INFORMATION info{};
  if (!GetFileInformationByHandle(handle, &info)
      || (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
      || bool(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != directory) Denied();
  PSID owner = nullptr; PACL dacl = nullptr; LocalMemory security;
  if (GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
      &owner, nullptr, &dacl, nullptr, reinterpret_cast<PSECURITY_DESCRIPTOR*>(&security.value)) != ERROR_SUCCESS) Denied();
  auto token = UserToken(); PSID user = reinterpret_cast<TOKEN_USER*>(token.data())->User.Sid;
  if (!owner || !EqualSid(owner, user) || !dacl || !IsValidAcl(dacl)) Denied();
  bool ownerAllowed = false;
  for (DWORD i = 0; i < dacl->AceCount; i++) {
    PVOID raw = nullptr; if (!GetAce(dacl, i, &raw)) Denied();
    auto header = static_cast<ACE_HEADER*>(raw);
    if (header->AceType == ACCESS_DENIED_ACE_TYPE) continue;
    if (header->AceType != ACCESS_ALLOWED_ACE_TYPE) Denied();
    auto ace = static_cast<ACCESS_ALLOWED_ACE*>(raw); PSID sid = &ace->SidStart;
    if (!IsValidSid(sid) || (!EqualSid(sid, user) && !IsWellKnownSid(sid, WinLocalSystemSid))) Denied();
    if (EqualSid(sid, user) && (ace->Mask & FILE_ALL_ACCESS) == FILE_ALL_ACCESS) ownerAllowed = true;
  }
  if (!ownerAllowed) Denied();
}
inline void CheckPath(const std::wstring& path, bool directory) {
  Handle handle(CreateFileW(path.c_str(), READ_CONTROL | FILE_READ_ATTRIBUTES,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
    FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr));
  CheckHandle(handle.value, directory);
}
inline void Descriptor(LocalMemory& descriptor, bool directory) {
  auto token = UserToken(); LocalMemory text;
  if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(token.data())->User.Sid,
      reinterpret_cast<LPWSTR*>(&text.value))) Denied();
  std::wstring sid(static_cast<LPWSTR>(text.value));
  const std::wstring inherit = directory ? L"OICI" : L"";
  const std::wstring sddl = L"O:" + sid + L"D:P(A;" + inherit + L";FA;;;SY)(A;" + inherit + L";FA;;;" + sid + L")";
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1,
      reinterpret_cast<PSECURITY_DESCRIPTOR*>(&descriptor.value), nullptr)) Denied();
}
template<class Action> Napi::Value Guard(const Napi::CallbackInfo& info, Action action) {
  try { return action(); } catch (...) { throw Napi::Error::New(info.Env(), "secret_access_denied"); }
}
inline Napi::Value Directory(const Napi::CallbackInfo& info) {
  return Guard(info, [&]() -> Napi::Value {
    if (info.Length() != 1) Denied(); const auto path = Path(info[0]);
    LocalMemory descriptor; Descriptor(descriptor, true);
    SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), descriptor.value, FALSE};
    if (!CreateDirectoryW(path.c_str(), &attributes) && GetLastError() != ERROR_ALREADY_EXISTS) Denied();
    CheckPath(path, true); return info.Env().Undefined();
  });
}
inline Napi::Value AssertDirectory(const Napi::CallbackInfo& info) {
  return Guard(info, [&]() -> Napi::Value { if (info.Length() != 1) Denied(); CheckPath(Path(info[0]), true); return info.Env().Undefined(); });
}
inline Napi::Value AssertFile(const Napi::CallbackInfo& info) {
  return Guard(info, [&]() -> Napi::Value { if (info.Length() != 1) Denied(); CheckPath(Path(info[0]), false); return info.Env().Undefined(); });
}
inline Napi::Value WriteTemporary(const Napi::CallbackInfo& info) {
  return Guard(info, [&]() -> Napi::Value {
    if (info.Length() != 2 || !info[1].IsTypedArray() || info[1].As<Napi::TypedArray>().TypedArrayType() != napi_uint8_array) Denied();
    const auto path = Path(info[0]); const auto parent = path.substr(0, path.find_last_of(L'\\'));
    CheckPath(parent, true);
    const auto bytes = info[1].As<Napi::Uint8Array>();
    if (bytes.ElementLength() == 0 || bytes.ElementLength() > 64 * 1024 * 1024 + 4121) Denied();
    LocalMemory descriptor; Descriptor(descriptor, false);
    SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), descriptor.value, FALSE};
    Handle file(CreateFileW(path.c_str(), GENERIC_WRITE | READ_CONTROL | FILE_READ_ATTRIBUTES, 0,
      &attributes, CREATE_NEW, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    CheckHandle(file.value, false); DWORD offset = 0;
    while (offset < bytes.ElementLength()) {
      DWORD written = 0;
      if (!WriteFile(file.value, bytes.Data() + offset, static_cast<DWORD>(bytes.ElementLength() - offset), &written, nullptr) || written == 0) Denied();
      offset += written;
    }
    if (!FlushFileBuffers(file.value)) Denied(); return info.Env().Undefined();
  });
}
inline Napi::Value Publish(const Napi::CallbackInfo& info) {
  return Guard(info, [&]() -> Napi::Value {
    if (info.Length() != 3 || !info[2].IsBoolean()) Denied();
    const auto source = Path(info[0]), target = Path(info[1]); const bool replace = info[2].As<Napi::Boolean>().Value();
    const auto parent = source.substr(0, source.find_last_of(L'\\'));
    if (_wcsicmp(parent.c_str(), target.substr(0, target.find_last_of(L'\\')).c_str()) != 0) Denied();
    CheckPath(parent, true); CheckPath(source, false);
    const DWORD attributes = GetFileAttributesW(target.c_str());
    if (attributes != INVALID_FILE_ATTRIBUTES) CheckPath(target, false);
    else if (GetLastError() != ERROR_FILE_NOT_FOUND) Denied();
    if (!MoveFileExW(source.c_str(), target.c_str(), MOVEFILE_WRITE_THROUGH | (replace ? MOVEFILE_REPLACE_EXISTING : 0))) {
      const DWORD error = GetLastError();
      if (!replace && (error == ERROR_ALREADY_EXISTS || error == ERROR_FILE_EXISTS)) return Napi::Boolean::New(info.Env(), false);
      Denied();
    }
    CheckPath(target, false); return Napi::Boolean::New(info.Env(), true);
  });
}
inline void Export(Napi::Env env, Napi::Object exports) {
  exports.Set("cccRecordStorageVersion", Napi::Number::New(env, 1));
  exports.Set("createPrivateDirectory", Napi::Function::New(env, Directory));
  exports.Set("assertPrivateDirectory", Napi::Function::New(env, AssertDirectory));
  exports.Set("assertPrivateFile", Napi::Function::New(env, AssertFile));
  exports.Set("writePrivateTemporary", Napi::Function::New(env, WriteTemporary));
  exports.Set("publishPrivateFile", Napi::Function::New(env, Publish));
}
} // namespace ccc_records
