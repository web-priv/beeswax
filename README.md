BEESWAX
=======

A platform for protecting private data from exfiltration in web
applications.  The prototype ships as a Chrome extension.


Development
-----------

The extension code requires compilation. There are several files that are preprocessed and bundled into one.

1. You will need to install a java runtime (headless is fine). This is necessary for running the google closure compiler.

1. Just hit make

   `$ make`
   
*There is a debug flag that can be turned on to disable some name mangling and ease debugging: `$ make DEBUG=1`  Be warned that the debugging option includes additional code in the runtime useful for testing crypto routines, which shouldn't be present normally.*

Installation
------------

Until the extension is distributed as a single file, it needs to be installed as a developer extension.
A few files must be compiled before the extension can be installed properly. Follow steps in [Development](#development) section to know how to generate them.

It needs to be installed as a developer extension.

1. Go to `about:extensions`

2. Tick `Developer Mode`

3. Click `Load unpacked extension...`

4. Select the `mon/ext/` directory.

Configuration
-------------

The extension can manage multiple accounts. To add a first account:


1. Activate the Beeswax browser action

1. Click `Add New`. Enter a twitter username.

1. You will be prompted to import key material. You may skip this step, in which case new keys will be generated in the extension.

1. The extension will periodically attempt to post the new account's keys to Twitter. This may be attempted again by clicking the "Post to Twitter" button.

Posting To Twitter
------------------

To be able to post to Twitter on behalf of the user, the user should
have a browser tab open to Twitter.com, logged in as the beeswax
account. The extension does not (yet) rely on OAuth to post to the
user's Twitter account, rather it posts to twitter via a content
script using the form present in the page.

Release Notes
-------------

The extension only tracks one set of keys per user. It does not
remember keys that were marked invalid in the past.

Users may not change their Twitter usernames on their account once
these usernames have been configured in beeswax. Changing your twitter
username will invalidate existing friendships and keys, and will
require reconfiguring beeswax.  Arguably, we could rely on twitter IDs
instead, but users recognize (and trust) names, not IDs. Twitter IDs
are still folded in the signatures of public key posts however and are
included in the verification process.

Posting a new key to Twitter does not immediately invalidate existing
friendships and keys. It should. The periodic watch for refreshing
user keys should however take care of that when it gets to it.
