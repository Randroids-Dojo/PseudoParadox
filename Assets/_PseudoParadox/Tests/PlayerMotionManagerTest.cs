using System.Collections.Generic;
using _PseudoParadox.Scripts.Core;
using NUnit.Framework;
using UnityEngine;

namespace _PseudoParadox.Tests
{
    public class PlayerMotionManagerTest
    {

        PlayerPositionManager playerPositionManager;
        string givenCurrentTime = "12:10:00";
        Vector3 givenCurrentPosition = new Vector3(10, 11, 12);
        Dictionary<string, Vector3> timeToPositionDictCopy;

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(playerPositionManager.gameObject);
        }

        [Test]
        public void WhenPlayerMotionManagerCreatedThenDefaultPropertiesSet()
        {
            WhenPlayerPositionManagerCreated();

            ThenDefaultPropertiesWereSet();
        }

        [Test]
        public void WhenStorePositionCalledThenPositionSaved()
        {
            GivenPlayerPositionManager();
            GivenCurrentTimeAndPositionAreSet();

            WhenStorePositionCalled();

            ThenPositionWasSaved();
        }

        [Test]
        public void WhenSaveTimeTravelCalledThenTimeTravelSaved()
        {
            GivenPlayerPositionManager();
            GivenCurrentTimeAndPositionAreSet();
            GivenSomePositionStored();

            WhenSaveTimeTravelCalled();

            ThenTimeTravelWasSaved();
        }

        private void GivenPlayerPositionManager()
        {
            GameObject playerPositionManagerGameObject = MonoBehaviour.Instantiate(Resources.Load<GameObject>("Prefabs/PlayerPositionManager"));
            playerPositionManager = playerPositionManagerGameObject.GetComponent<PlayerPositionManager>();
        }
        private void GivenCurrentTimeAndPositionAreSet()
        {
            givenCurrentTime = "12:10:00";
            givenCurrentPosition = new Vector3(10, 11, 12);
        }

        private void WhenPlayerPositionManagerCreated()
        {
            GivenPlayerPositionManager();
        }

        private void WhenStorePositionCalled()
        {
            playerPositionManager.StorePosition(givenCurrentPosition, givenCurrentTime);
        }

        private void WhenSaveTimeTravelCalled()
        {
            playerPositionManager.SaveTimeTravel();
        }

        private void GivenSomePositionStored()
        {
            playerPositionManager.StorePosition(givenCurrentPosition, givenCurrentTime);
            timeToPositionDictCopy = new Dictionary<string, Vector3>(playerPositionManager.timeToPositionDict);
        }

        private void ThenDefaultPropertiesWereSet()
        {
            Assert.AreEqual(Vector3.zero, playerPositionManager.startingPosition);
            Assert.AreEqual(0, playerPositionManager.currentInstance);
            Assert.IsFalse(playerPositionManager.shouldResetPosition);
            Assert.IsEmpty(playerPositionManager.timeToPositionDict);
            Assert.IsEmpty(playerPositionManager.timeMachine);
        }

        private void ThenPositionWasSaved()
        {
            Assert.AreEqual(givenCurrentPosition, playerPositionManager.timeToPositionDict[givenCurrentTime]);
        }

        private void ThenTimeTravelWasSaved()
        {
            Assert.AreEqual(timeToPositionDictCopy, playerPositionManager.timeMachine[0]);
            Assert.IsEmpty(playerPositionManager.timeToPositionDict);
            Assert.AreEqual(1, playerPositionManager.currentInstance);
            Assert.True(playerPositionManager.shouldResetPosition);
        }

    }
}
