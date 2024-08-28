# content-sharing
This module contains a Java servlet that allows an unauthenticated visitor to access content that is
not normally public.  
To do this, the contributor can generate a sharing URL for each piece of content and distribute it
to the appropriate recipients.

![100]

To generate the sharing URL, the contributor uses a specific Jahia [selectorType] contained in this module.
This selectorType can be configured to define the key length(`length`, default **24**), the type of characters
used in the key (`format`, default **aA#!**),
as well as the origin (`origin`, default **window.location.origin**) of the generated URL.

```json
{
  "name": "semix:sharedUrl",
  "fields": [
    {
      "name": "se:sharedUrl",
      "selectorType": "SharedURLGenerator",
      "selectorOptionsMap": {
        "length": 16,
        "format": "aA#!",
        "origin": "https://www.jahia.com"
      }
    }
  ]
}
```





[100]: doc/images/000_shared_URL_UI.png
[selectorType]:https://github.com/Jahia/content-sharing/blob/main/src/javascript/SharedURLGenerator/SharedURLGenerator.jsx