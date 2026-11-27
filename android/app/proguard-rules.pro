# kotlinx.serialization: keep the generated serializers of the core's @Serializable classes.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class com.authbackup.core.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.authbackup.core.**$$serializer { *; }
