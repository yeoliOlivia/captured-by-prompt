Pod::Spec.new do |s|
  s.name = 'CapturedPhotos'
  s.version = '0.1.0'
  s.summary = 'Native Photos operations for Captured by Prompt'
  s.description = 'Operate on explicitly selected Photos assets using PhotoKit.'
  s.license = { :type => 'Proprietary' }
  s.author = 'Captured contributors'
  s.homepage = 'https://github.com/yeoliOlivia/captured-by-prompt'
  s.source = { :git => 'https://github.com/yeoliOlivia/captured-by-prompt.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Photos', 'PhotosUI', 'UIKit', 'UniformTypeIdentifiers'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
