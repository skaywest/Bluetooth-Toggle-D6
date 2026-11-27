#include <windows.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Devices.Radios.h>
#include <iostream>
#include <string>
using namespace winrt;
using namespace Windows::Devices::Radios;
int wmain(int argc, wchar_t** argv) {
 try {
  init_apartment(apartment_type::multi_threaded);
  auto radios=Radio::GetRadiosAsync().get();
  Radio bt{nullptr};
  for (auto const& r:radios) if(r.Kind()==RadioKind::Bluetooth){bt=r;break;}
  if(!bt){std::wcout<<L"{\"ok\":false,\"error\":\"Bluetooth radio not found\"}";return 2;}
  std::wstring mode=argc>1?argv[1]:L"status";
  if(mode==L"toggle"){
   if(Radio::RequestAccessAsync().get()!=RadioAccessStatus::Allowed){std::wcout<<L"{\"ok\":false,\"error\":\"Windows denied radio access\"}";return 3;}
   auto target=bt.State()==RadioState::On?RadioState::Off:RadioState::On;
   if(bt.SetStateAsync(target).get()!=RadioAccessStatus::Allowed){std::wcout<<L"{\"ok\":false,\"error\":\"Windows refused state change\"}";return 4;}
   auto check=Radio::GetRadiosAsync().get();
   for(auto const& r:check) if(r.Kind()==RadioKind::Bluetooth){std::wcout<<L"{\"ok\":true,\"state\":\""<<(r.State()==RadioState::On?L"on":L"off")<<L"\"}";return 0;}
   return 5;
  }
  std::wcout<<L"{\"ok\":true,\"state\":\""<<(bt.State()==RadioState::On?L"on":L"off")<<L"\"}";
  return 0;
 } catch(hresult_error const& e){std::wcerr<<e.message().c_str();return 10;}
 catch(...){std::wcerr<<L"Unknown native error";return 11;}
}